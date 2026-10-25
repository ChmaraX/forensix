/**
 * Errors that only the CLI raises (the audit log and the bundled skill files).
 * They print the same diagnostic shape as a core ForensixError.
 */
export type CliErrorCode =
  | "AUDIT_LOG_FAILED"
  | "AUDIT_LOG_NOT_FOUND"
  | "SKILLS_UNAVAILABLE";

export class CliError extends Error {
  public readonly code: CliErrorCode;
  public readonly details: Readonly<Record<string, unknown>>;

  public constructor(
    code: CliErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.details = details;
  }

  public toDiagnostic(): Readonly<Record<string, unknown>> {
    return {
      status: "error",
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}
