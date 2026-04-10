import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { CodeBuildClient, BatchGetBuildsCommand } from "@aws-sdk/client-codebuild";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({});
const codebuild = new CodeBuildClient({});

const {
  S3_BUCKET = "",
  OUTPUT_SPPKG_NAME = "custom-new-item.sppkg",
  PRESIGNED_URL_EXPIRES_SECONDS = "3600",
} = process.env;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": process.env.CORS_ORIGIN || "*",
      "access-control-allow-methods": "GET,OPTIONS",
      "access-control-allow-headers": "content-type",
    },
    body: JSON.stringify(body),
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
          "access-control-allow-methods": "GET,OPTIONS",
          "access-control-allow-headers": "content-type",
        },
        body: "",
      };
    }
    if (method !== "GET") return json(405, { error: "Method not allowed" });
    if (!S3_BUCKET) return json(500, { error: "Missing env: S3_BUCKET" });

    const qs = event.queryStringParameters || {};
    const codeBuildId = String(qs.codeBuildId || "").trim();
    const buildPrefix = String(qs.buildPrefix || "").trim();
    const outputSppkgName = (String(qs.outputSppkgName || "").trim() || OUTPUT_SPPKG_NAME).trim();

    if (!codeBuildId) return json(400, { error: "query param codeBuildId is required" });
    if (!buildPrefix) return json(400, { error: "query param buildPrefix is required" });

    const batch = await codebuild.send(new BatchGetBuildsCommand({ ids: [codeBuildId] }));
    const build = batch.builds?.[0];
    if (!build) return json(404, { error: "CodeBuild build not found" });

    const status = build.buildStatus || "UNKNOWN";
    const outKey = `${buildPrefix}/output/${outputSppkgName}`;

    if (status !== "SUCCEEDED") {
      return json(200, {
        status,
        codeBuildId,
        buildPrefix,
        outputS3Key: outKey,
        message: build.statusReason || status,
      });
    }

    const expiresIn = Math.max(60, Number(PRESIGNED_URL_EXPIRES_SECONDS || "3600"));
    const downloadUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: S3_BUCKET, Key: outKey }),
      { expiresIn }
    );

    return json(200, {
      status,
      codeBuildId,
      buildPrefix,
      sppkgS3Key: outKey,
      downloadUrl,
      expiresInSeconds: expiresIn,
    });
  } catch (e) {
    return json(500, {
      error: e?.message || String(e),
      stack: typeof e?.stack === "string" ? e.stack : undefined,
    });
  }
};

