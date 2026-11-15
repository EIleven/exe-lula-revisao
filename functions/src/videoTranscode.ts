import {GoogleAuth} from "google-auth-library";
import {
  FieldValue,
  Firestore,
  Timestamp,
} from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";

const PROJECT_ID = process.env.GCLOUD_PROJECT ||
  process.env.GCP_PROJECT || "echo-b5aw9";
const REGION = process.env.VIDEO_WORKER_REGION || "southamerica-east1";
const JOB_NAME = process.env.VIDEO_WORKER_JOB || "video-transcoder";
const auth = new GoogleAuth({scopes: ["https://www.googleapis.com/auth/cloud-platform"]});

const VALID_MEDIA_ID = /^[A-Za-z0-9_-]{22}$/;

/**
 * Reserva e inicia uma execução. A transação evita que o evento do Storage e
 * o varredor lancem o mesmo vídeo. Reserva abandonada expira automaticamente.
 */
export async function dispatchVideoTranscode(
  db: Firestore,
  mediaId: string
): Promise<boolean> {
  if (!VALID_MEDIA_ID.test(mediaId)) return false;
  const ref = db.collection("videoUploads").doc(mediaId);
  const reserved = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return false;
    const data = snapshot.data() || {};
    const status = data.status;
    if (["ready", "processing", "dispatched"].includes(status)) return false;
    if (status === "dispatching") {
      const lease = data.dispatchLeaseUntil as Timestamp | undefined;
      if (lease?.toMillis && lease.toMillis() > Date.now()) return false;
    }
    const dispatchable = ["uploading", "queued", "dispatching", "failed"];
    if (!dispatchable.includes(status)) return false;
    transaction.update(ref, {
      status: "dispatching",
      dispatchLeaseUntil: Timestamp.fromMillis(Date.now() + 5 * 60 * 1000),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(db.collection("media").doc(mediaId), {
      processingStatus: "dispatching",
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
  if (!reserved) return false;

  const endpoint = `https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/jobs/${JOB_NAME}:run`;
  try {
    const client = await auth.getClient();
    const response = await client.request<{name?: string}>({
      url: endpoint,
      method: "POST",
      data: {
        overrides: {
          containerOverrides: [{
            env: [{name: "VIDEO_MEDIA_ID", value: mediaId}],
          }],
          taskCount: 1,
          timeout: "14400s",
        },
      },
    });
    await ref.update({
      status: "dispatched",
      executionName: response.data?.name || null,
      attempts: FieldValue.increment(1),
      dispatchLeaseUntil: FieldValue.delete(),
      dispatchedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await db.collection("media").doc(mediaId).update({
      processingStatus: "dispatched",
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  } catch (error) {
    logger.error(`[video] falha ao iniciar worker para ${mediaId}`, error);
    await Promise.all([
      ref.update({
        status: "queued",
        dispatchLeaseUntil: FieldValue.delete(),
        lastDispatchError: "worker-start-failed",
        updatedAt: FieldValue.serverTimestamp(),
      }),
      db.collection("media").doc(mediaId).update({
        processingStatus: "queued",
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);
    return false;
  }
}
