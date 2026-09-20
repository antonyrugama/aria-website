# Clear replaced approval lookup results (#10516)

- **Symptom**: A denied lookup left an earlier approved result visible.
- **Root cause**: Starting another lookup cleared its error but retained the previous result.
- **Exact fix**: Clear and hide the result when the lookup form is submitted.
- **Prevention guardrail**: Real-shell submissions check pending replacement, denial, and recovery.
- **Test coverage added**: Two lookup regressions with source-mutation controls.
- **Deployment/runtime caveat**: Static-script update; no API or permission changes.
