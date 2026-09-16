/**
 * A model validation failure identified by its field path and error code.
 *
 * @property path - The affected field path, or "$" for the root value.
 * @property code - The validation issue identifier.
 */
export type ModelValidationIssue = { path: string; code: string };

/**
 * An error representing a failure that should not be retried.
 */
export class PermanentError extends Error {
    /**
     * Creates a permanent failure.
     *
     * @param message - The error description.
     */
    constructor(message?: string) {
        super(message);
        this.name = "PermanentError";
    }
}

/**
 * An invalid, incomplete, or provider-rejected model response.
 */
export class ModelOutputError extends Error {
    readonly provider = "groq";
    readonly code = "json_validate_failed";
    correctionAttempted = false;
    /**
     * Creates an error describing a model output validation failure.
     *
     * @param message - The error description.
     * @param kind - The category of output failure.
     * @param issues - Field-level validation details.
     * @param status - The HTTP status returned by the provider, if available.
     */
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