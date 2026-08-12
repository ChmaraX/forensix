export type ForensixErrorCode =
  | "INVALID_ARGUMENT"
  | "UNSUPPORTED_NODE_VERSION"
  | "SOURCE_NOT_FOUND"
  | "SOURCE_NOT_DIRECTORY"
  | "CASE_ALREADY_EXISTS"
  | "CASE_INSIDE_SOURCE"
  | "INGEST_FAILED"
  | "CASE_NOT_FOUND"
  | "CASE_INVALID"
  | "WORKING_COPY_INTEGRITY_REFUSAL";

export interface ErrorDiagnostic {
  readonly status: "error";
  readonly code: ForensixErrorCode;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export class ForensixError extends Error {
  public readonly code: ForensixErrorCode;
  public readonly details: Readonly<Record<string, unknown>>;

  public constructor(
    code: ForensixErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ForensixError";
    this.code = code;
    this.details = details;
  }

  public toDiagnostic(): ErrorDiagnostic {
    return {
      status: "error",
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

export type WorkingCopyIssueReason =
  | "working_copy_missing"
  | "entry_missing"
  | "entry_not_regular_file"
  | "entry_unreadable"
  | "entry_hash_mismatch"
  | "entry_size_mismatch"
  | "unexpected_entry"
  | "manifest_digest_mismatch"
  | "working_copy_digest_mismatch";

export interface WorkingCopyIssue {
  readonly path: string;
  readonly reason: WorkingCopyIssueReason;
  readonly expected?: string | number;
  readonly actual?: string | number | null;
}

export class WorkingCopyIntegrityRefusal extends ForensixError {
  public readonly issues: readonly WorkingCopyIssue[];

  public constructor(issues: readonly WorkingCopyIssue[]) {
    super(
      "WORKING_COPY_INTEGRITY_REFUSAL",
      "Analysis refused because Working Copy verification failed.",
      { issues },
    );
    this.name = "WorkingCopyIntegrityRefusal";
    this.issues = issues;
  }
}
