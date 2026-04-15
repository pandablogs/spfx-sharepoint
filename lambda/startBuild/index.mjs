import crypto from "crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  CodeBuildClient,
  StartBuildCommand,
} from "@aws-sdk/client-codebuild";

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

function parseJson(event) {
  const raw =
    typeof event.body === "string"
      ? Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8").toString("utf8")
      : "{}";

  let body;
  try {
    body = JSON.parse(raw || "{}");
  } catch (e) {
    throw new Error("Invalid JSON body");
  }

  // Allow posting the Form.io schema directly as the body:
  // - body.display + body.components => treat body as the schema
  const looksLikeFormio =
    body && typeof body === "object" && typeof body.display === "string" && Array.isArray(body.components);

  return {
    outputSppkgName: String(body.outputSppkgName || body.OUTPUT_SPPKG_NAME || "").trim(),
    listGuid: String(body.listGuid || body.listGUID || body.listId || "").trim(),
    formio: looksLikeFormio ? body : (body.formio || body.formioSchema || body.schema || body.form || undefined),
    formTitle: typeof body.formTitle === "string" ? body.formTitle : undefined,
    formCss: typeof body.formCss === "string" ? body.formCss : undefined,
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

    let req;
    try {
      req = parseJson(event);
    } catch (e) {
      return json(400, { error: e?.message || String(e) });
    }

    if (!req.listGuid) return json(400, { error: "Missing required field: listGuid" });
    if (!req.formio || typeof req.formio !== "object") {
      return json(400, { error: "Missing required field: formio (Form.io JSON object)" });
    }

    const buildPrefix = `builds/${crypto.randomUUID()}`;
    const outputName = (req.outputSppkgName || OUTPUT_SPPKG_NAME).trim();
    const outKey = `${buildPrefix}/output/${outputName}`;

    const inputKey = `${buildPrefix}/input/build-input.json`;
    const buildInput = {
      version: 1,
      listGuid: req.listGuid,
      formio: req.formio,
      formTitle: req.formTitle,
      formCss: req.formCss,
      outputSppkgName: outputName,
    };

    await s3.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: inputKey,
        Body: JSON.stringify(buildInput),
        ContentType: "application/json",
      })
    );

    const startOut = await codebuild.send(
      new StartBuildCommand({
        projectName: CODEBUILD_PROJECT_NAME,
        environmentVariablesOverride: [
          { name: "S3_BUCKET", value: S3_BUCKET, type: "PLAINTEXT" },
          { name: "BUILD_PREFIX", value: buildPrefix, type: "PLAINTEXT" },
          { name: "OUTPUT_SPPKG_NAME", value: outputName, type: "PLAINTEXT" },
          { name: "BUILD_INPUT_S3_KEY", value: inputKey, type: "PLAINTEXT" },
          { name: "LIST_GUID", value: req.listGuid, type: "PLAINTEXT" },
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

