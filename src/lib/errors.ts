export type ModelValidationIssue = { path: string; code: string };

export class PermanentError extends Error {
    constructor(message?: string) {
        super(message);
        this.name = "PermanentError";
    }
}

export class ModelOutputError extends Error {
    readonly provider = "groq";
    readonly code = "json_validate_failed";
    correctionAttempted = false;
    constructor(
        message = "The model returned invalid research data.",
        readonly kind:
            | "truncated"
            | "invalid_json"
            | "schema_validation"
            | "provider_schema_validation" = "schema_validation",
        readonly issues: ModelValidationIssue[] = [],
        public status?: number,
    ) {
        super(message);
        this.name = "ModelOutputError";
    }
}