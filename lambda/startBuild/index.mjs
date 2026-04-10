import crypto from "crypto";
import Busboy from "busboy";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import {
  CodeBuildClient,
  StartBuildCommand,
  BatchGetBuildsCommand,
} from "@aws-sdk/client-codebuild";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({});
const codebuild = new CodeBuildClient({});

const {
  S3_BUCKET = "",
  CODEBUILD_PROJECT_NAME = "",
  OUTPUT_SPPKG_NAME = "custom-new-item.sppkg",
  PRESIGNED_URL_EXPIRES_SECONDS = "3600",
} = process.env;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": process.env.CORS_ORIGIN || "*",
      "access-control-allow-methods": "POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    },
    body: JSON.stringify(body),
  };
}

async function parseMultipart(event) {
  const headers = event.headers || {};
  const contentType = headers["content-type"] || headers["Content-Type"] || "";
  const rawBody =
    typeof event.body === "string"
      ? Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8")
      : Buffer.from("");

  const fields = {};
  /** @type {{ buffer?: Buffer, contentType?: string }} */
  const file = {};

  await new Promise((resolve, reject) => {
    const bb = Busboy({ headers: { "content-type": contentType } });

    bb.on("field", (name, value) => {
      fields[name] = value;
    });

    bb.on("file", (name, stream, info) => {
      if (name !== "formHtml") {
        stream.resume();
        return;
      }
      file.contentType = info?.mimeType || "text/html";
      const chunks = [];
      stream.on("data", (d) => chunks.push(d));
      stream.on("end", () => {
        file.buffer = Buffer.concat(chunks);
      });
    });

    bb.on("error", reject);
    bb.on("finish", resolve);
    bb.end(rawBody);
  });

  return {
    listUrl: String(fields.listUrl || fields.LIST_URL || "").trim(),
    spfxPageUrl: String(fields.spfxPageUrl || fields.SPFX_PAGE_URL || "").trim(),
    columns: String(fields.columns || fields.COLUMNS || "").trim(),
    outputSppkgName: String(fields.outputSppkgName || fields.OUTPUT_SPPKG_NAME || "").trim(),
    fileBuffer: file.buffer,
    fileContentType: file.contentType || "text/html",
  };
}

export const handler = async (event) => {
  try {
    const method = (event.requestContext?.http?.method || event.httpMethod || "").toUpperCase();
    if (method === "OPTIONS") {
      return {
        statusCode: 204,
        headers: {
          "access-control-allow-origin": process.env.CORS_ORIGIN || "*",
          "access-control-allow-methods": "POST,OPTIONS",
          "access-control-allow-headers": "content-type",
        },
        body: "",
      };
    }
    if (method !== "POST") return json(405, { error: "Method not allowed" });

    if (!S3_BUCKET) return json(500, { error: "Missing env: S3_BUCKET" });
    if (!CODEBUILD_PROJECT_NAME) return json(500, { error: "Missing env: CODEBUILD_PROJECT_NAME" });

    const headers = event.headers || {};
    const contentType = String(headers["content-type"] || headers["Content-Type"] || "").toLowerCase();
    if (!contentType.startsWith("multipart/form-data")) {
      return json(400, {
        error: "Send multipart/form-data with file field name 'formHtml'.",
        receivedContentType: contentType || null,
      });
    }

    let req;
    try {
      req = await parseMultipart(event);
    } catch (e) {
      return json(400, { error: e?.message || String(e) });
    }

    if (!req.listUrl) return json(400, { error: "LIST_URL (listUrl) required" });
    if (!req.spfxPageUrl) return json(400, { error: "SPFX_PAGE_URL (spfxPageUrl) required" });
    if (!req.fileBuffer || req.fileBuffer.length === 0) return json(400, { error: "formHtml file required" });

    const buildPrefix = `builds/${crypto.randomUUID()}`;
    const outputName = (req.outputSppkgName || OUTPUT_SPPKG_NAME).trim();
    const formKey = `${buildPrefix}/form.html`;
    const outKey = `${buildPrefix}/output/${outputName}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: formKey,
        Body: req.fileBuffer,
        ContentType: req.fileContentType || "text/html",
      })
    );

    const startOut = await codebuild.send(
      new StartBuildCommand({
        projectName: CODEBUILD_PROJECT_NAME,
        environmentVariablesOverride: [
          { name: "LIST_URL", value: req.listUrl, type: "PLAINTEXT" },
          { name: "SPFX_PAGE_URL", value: req.spfxPageUrl, type: "PLAINTEXT" },
          { name: "COLUMNS", value: req.columns || " ", type: "PLAINTEXT" },
          { name: "S3_BUCKET", value: S3_BUCKET, type: "PLAINTEXT" },
          { name: "BUILD_PREFIX", value: buildPrefix, type: "PLAINTEXT" },
          { name: "OUTPUT_SPPKG_NAME", value: outputName, type: "PLAINTEXT" },
        ],
      })
    );

    const codeBuildId = startOut.build?.id;
    if (!codeBuildId) return json(502, { error: "CodeBuild did not return build id" });

    // Return immediately; client should call GET /status with codeBuildId+buildPrefix.
    return json(202, {
      status: "IN_PROGRESS",
      codeBuildId,
      buildPrefix,
      outputS3Key: outKey,
      outputSppkgName: outputName,
      message: "Build started. Poll status endpoint until SUCCEEDED for downloadUrl.",
    });
  } catch (e) {
    return json(500, {
      error: e?.message || String(e),
      stack: typeof e?.stack === "string" ? e.stack : undefined,
    });
  }
};

