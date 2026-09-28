# Name the app that reported nothing in the usage split (#10840)

- **Symptom**: Under every app, the split said "Only Mobile is in this selection" when Coaches Web had reported nothing.
- **Root cause**: The pane never read the route's `notReporting` list, so the missing column looked like a filter.
- **Exact fix**: The split card and the empty card print each `notReporting[].detail` verbatim when the list is non-empty.
- **Prevention guardrail**: The fixture now carries `notReporting`, and the tests bind both the named and fallback copy.
- **Test coverage added**: Three analytics pane tests: one unread app, the fallback copy, and an empty answer.
- **Deployment/runtime caveat**: Static asset only; an older backend without `notReporting` keeps the previous copy.
