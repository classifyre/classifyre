import re
import subprocess
import sys
from pathlib import Path

# Paths relative to apps/cli
SCHEMA_DIR = Path("../../packages/schemas/src/schemas")
MODEL_DIR = Path("src/models")

# Pipeline schema classes whose `type` field should default to the literal value.
# datamodel-codegen generates `type: Literal['X']` without a default, but these
# discriminator fields are always the same value, so the default must be injected.
_PIPELINE_TYPE_DEFAULTS: dict[str, str] = {
    "GLiNER2PipelineSchema": "GLINER2",
    "RegexPipelineSchema": "REGEX",
    "LLMPipelineSchema": "LLM",
}


def _patch_pipeline_type_defaults(source: str) -> str:
    """Add `= 'X'` default to discriminator `type` fields on pipeline schemas."""
    for cls_name, default_val in _PIPELINE_TYPE_DEFAULTS.items():
        # Match the class body and replace `type: Literal['X']` (no default) with
        # `type: Literal['X'] = 'X'` so callers don't have to pass the type field.
        pattern = rf"(class {re.escape(cls_name)}\(.*?\):.*?type:\s*Literal\['{re.escape(default_val)}'\])(\s)"
        replacement = rf"\1 = '{default_val}'\2"
        source = re.sub(pattern, replacement, source, flags=re.DOTALL)
    return source


def run_codegen(input_file):
    """Generate Pydantic models from a single JSON schema file."""
    cmd = [
        sys.executable,
        "-m",
        "datamodel_code_generator",
        "--output-model-type",
        "pydantic_v2.BaseModel",
        "--input-file-type",
        "jsonschema",
        "--use-standard-collections",
        "--use-schema-description",
        "--field-constraints",
        "--target-python-version",
        "3.12",
        "--use-union-operator",
        "--use-specialized-enum",
        "--use-title-as-name",
        "--collapse-root-models",
        "--disable-timestamp",
        "--input",
        str(input_file),
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return result.stdout


def main():
    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    # delete all files in the MODEL_DIR
    for file in MODEL_DIR.glob("*.py"):
        file.unlink()

    # Generate models from merged input_refactored.json
    input_schema = SCHEMA_DIR / "all_input_sources.json"
    content = run_codegen(input_schema)

    (MODEL_DIR / "generated_input.py").write_text(content)
    print("Wrote src/models/generated_input.py")

    # all detectors
    detector_schema = SCHEMA_DIR / "all_detectors.json"
    content = run_codegen(detector_schema)
    content = _patch_pipeline_type_defaults(content)
    (MODEL_DIR / "generated_detectors.py").write_text(content)
    print("Wrote src/models/generated_detectors.py")

    # single asset scan results
    single_asset_scan_results_schema = SCHEMA_DIR / "single_asset_scan_results.json"
    content = run_codegen(single_asset_scan_results_schema)
    (MODEL_DIR / "generated_single_asset_scan_results.py").write_text(content)
    print("Wrote src/models/generated_single_asset_scan_results.py")


if __name__ == "__main__":
    main()
