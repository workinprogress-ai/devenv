// commit-approval.ts — host-neutral, one-use approval state for repo-commit.

import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  linkSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export const COMMIT_APPROVAL_PROTOCOL_VERSION = 1;
export const COMMIT_APPROVAL_TTL_MS = 10 * 60_000;
const REQUEST_ID_PATTERN = /^[0-9a-f]{48}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const HEAD_PATTERN = /^[0-9a-f]{40,64}$/;

export type CommitApprovalOutcome = "approve" | "cancel";
export type CommitApprovalLane = "commit" | "amend" | "reword";

export interface CommitApprovalIdentity {
  repositoryRoot: string;
  gitCommonDir: string;
  head: string;
  stagedDigest: string;
  proposedMessageDigest: string;
  sessionId: string;
}

export interface CommitApprovalRequest extends CommitApprovalIdentity {
  protocolVersion: typeof COMMIT_APPROVAL_PROTOCOL_VERSION;
  requestId: string;
  lane: CommitApprovalLane;
  target: string;
  proposedMessage: string;
  createdAt: string;
  expiresAt: string;
}

export type CommitApprovalResponse =
  | {
    protocolVersion: typeof COMMIT_APPROVAL_PROTOCOL_VERSION;
    requestId: string;
    sessionId: string;
    outcome: "approve";
    finalMessage: string;
    finalMessageDigest: string;
  }
  | {
    protocolVersion: typeof COMMIT_APPROVAL_PROTOCOL_VERSION;
    requestId: string;
    sessionId: string;
    outcome: "cancel";
  };

export type CommitApprovalFailure =
  | "malformed-request"
  | "malformed-response"
  | "expired"
  | "not-yet-valid"
  | "request-mismatch"
  | "session-mismatch"
  | "repository-mismatch"
  | "head-mismatch"
  | "staged-mismatch"
  | "proposed-message-mismatch"
  | "empty-message"
  | "final-message-mismatch";

export type CommitApprovalVerification =
  | { ok: true; outcome: "cancel" }
  | { ok: true; outcome: "approve"; finalMessage: string }
  | { ok: false; reason: CommitApprovalFailure };

export type CommitApprovalClaim =
  | { ok: true; path: string }
  | { ok: false; reason: "missing-request" | "already-claimed" | "claim-failed" };

export interface CommitApprovalRequestInput extends CommitApprovalIdentity {
  lane: CommitApprovalLane;
  target: string;
  proposedMessage: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbsolutePath(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/");
}

export function commitApprovalDigest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function commitApprovalNeedsBroker(
  sessionId: string,
  stdinIsTty: boolean | undefined,
  stdoutIsTty: boolean | undefined,
): boolean {
  return sessionId !== ""
    && (stdinIsTty !== true || stdoutIsTty !== true);
}

export function commitApprovalDirectory(gitCommonDir: string): string {
  return join(gitCommonDir, "devenv", "commit-approval");
}

export function commitApprovalRequestPath(gitCommonDir: string, requestId: string): string {
  return join(commitApprovalDirectory(gitCommonDir), `${requestId}.pending.json`);
}

export function commitApprovalClaimPath(requestPath: string): string {
  return requestPath.replace(/\.pending\.json$/, ".claimed.json");
}

export function createCommitApprovalRequest(
  input: CommitApprovalRequestInput,
  options: { now?: number; requestId?: string } = {},
): CommitApprovalRequest {
  const now = options.now ?? Date.now();
  const requestId = options.requestId ?? randomBytes(24).toString("hex");
  return {
    protocolVersion: COMMIT_APPROVAL_PROTOCOL_VERSION,
    requestId,
    ...input,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + COMMIT_APPROVAL_TTL_MS).toISOString(),
  };
}

function validRequest(value: unknown): value is CommitApprovalRequest {
  if (!isRecord(value)) return false;
  return value.protocolVersion === COMMIT_APPROVAL_PROTOCOL_VERSION
    && typeof value.requestId === "string"
    && REQUEST_ID_PATTERN.test(value.requestId)
    && typeof value.sessionId === "string"
    && value.sessionId.length > 0
    && (value.lane === "commit" || value.lane === "amend" || value.lane === "reword")
    && typeof value.target === "string"
    && value.target.length > 0
    && isAbsolutePath(value.repositoryRoot)
    && isAbsolutePath(value.gitCommonDir)
    && typeof value.head === "string"
    && HEAD_PATTERN.test(value.head)
    && typeof value.stagedDigest === "string"
    && DIGEST_PATTERN.test(value.stagedDigest)
    && typeof value.proposedMessage === "string"
    && typeof value.proposedMessageDigest === "string"
    && DIGEST_PATTERN.test(value.proposedMessageDigest)
    && value.proposedMessageDigest === commitApprovalDigest(value.proposedMessage)
    && typeof value.createdAt === "string"
    && Number.isFinite(Date.parse(value.createdAt))
    && typeof value.expiresAt === "string"
    && Number.isFinite(Date.parse(value.expiresAt))
    && Date.parse(value.expiresAt) - Date.parse(value.createdAt) === COMMIT_APPROVAL_TTL_MS;
}

function validResponse(value: unknown): value is CommitApprovalResponse {
  if (!isRecord(value)
    || value.protocolVersion !== COMMIT_APPROVAL_PROTOCOL_VERSION
    || typeof value.requestId !== "string"
    || !REQUEST_ID_PATTERN.test(value.requestId)
    || typeof value.sessionId !== "string"
    || value.sessionId.length === 0) {
    return false;
  }
  if (value.outcome === "cancel") return true;
  return value.outcome === "approve"
    && typeof value.finalMessage === "string"
    && typeof value.finalMessageDigest === "string"
    && DIGEST_PATTERN.test(value.finalMessageDigest);
}

export function parseCommitApprovalRequest(text: string): CommitApprovalRequest | null {
  try {
    const value: unknown = JSON.parse(text);
    return validRequest(value) ? value : null;
  } catch {
    return null;
  }
}

export function parseCommitApprovalResponse(text: string): CommitApprovalResponse | null {
  try {
    const value: unknown = JSON.parse(text);
    return validResponse(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeCommitApprovalRequest(
  gitCommonDir: string,
  request: CommitApprovalRequest,
): string {
  if (!validRequest(request)) throw new Error("invalid commit approval request");
  const directory = commitApprovalDirectory(gitCommonDir);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const path = commitApprovalRequestPath(gitCommonDir, request.requestId);
  writeFileSync(path, `${JSON.stringify(request, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

export function readCommitApprovalRequest(path: string): CommitApprovalRequest | null {
  try {
    return parseCommitApprovalRequest(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function claimCommitApprovalRequest(path: string): CommitApprovalClaim {
  const request = readCommitApprovalRequest(path);
  if (request === null) {
    return { ok: false, reason: "missing-request" };
  }
  if (!commitApprovalFileIsOwnerOnly(path)
    || !commitApprovalFileIsOwnerOnly(commitApprovalDirectory(request.gitCommonDir))) {
    return { ok: false, reason: "claim-failed" };
  }
  const claimPath = commitApprovalClaimPath(path);
  try {
    linkSync(path, claimPath);
    rmSync(path);
    chmodSync(claimPath, 0o600);
    return { ok: true, path: claimPath };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    return { ok: false, reason: code === "EEXIST" ? "already-claimed" : "claim-failed" };
  }
}

export function verifyCommitApproval(
  requestValue: unknown,
  responseValue: unknown,
  identity: CommitApprovalIdentity,
  now = Date.now(),
): CommitApprovalVerification {
  if (!validRequest(requestValue)) return { ok: false, reason: "malformed-request" };
  if (!validResponse(responseValue)) return { ok: false, reason: "malformed-response" };

  const createdAt = Date.parse(requestValue.createdAt);
  const expiresAt = Date.parse(requestValue.expiresAt);
  if (expiresAt <= now) return { ok: false, reason: "expired" };
  if (createdAt > now) return { ok: false, reason: "not-yet-valid" };
  if (responseValue.requestId !== requestValue.requestId) return { ok: false, reason: "request-mismatch" };
  if (responseValue.sessionId !== requestValue.sessionId || requestValue.sessionId !== identity.sessionId) {
    return { ok: false, reason: "session-mismatch" };
  }
  if (requestValue.repositoryRoot !== identity.repositoryRoot
    || requestValue.gitCommonDir !== identity.gitCommonDir) {
    return { ok: false, reason: "repository-mismatch" };
  }
  if (requestValue.head !== identity.head) return { ok: false, reason: "head-mismatch" };
  if (requestValue.stagedDigest !== identity.stagedDigest) return { ok: false, reason: "staged-mismatch" };
  if (requestValue.proposedMessageDigest !== identity.proposedMessageDigest) {
    return { ok: false, reason: "proposed-message-mismatch" };
  }
  if (responseValue.outcome === "cancel") return { ok: true, outcome: "cancel" };
  if (responseValue.finalMessage.trim() === "") return { ok: false, reason: "empty-message" };
  if (responseValue.finalMessageDigest !== commitApprovalDigest(responseValue.finalMessage)) {
    return { ok: false, reason: "final-message-mismatch" };
  }
  return { ok: true, outcome: "approve", finalMessage: responseValue.finalMessage };
}

export function commitApprovalFileIsOwnerOnly(path: string): boolean {
  return (statSync(path).mode & 0o077) === 0;
}
