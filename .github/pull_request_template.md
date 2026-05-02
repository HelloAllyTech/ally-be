## Summary

<!-- Briefly describe what this PR changes and why. -->

## Test plan

<!-- How did you verify this works? Repro steps, screenshots, test runs. -->

## Security checklist

- [ ] No real AWS resource IDs (`subnet-*`, `sg-*`, `vpc-*`, ARNs) in code or workflows — use `${{ vars.* }}` / `${{ secrets.* }}` instead.
- [ ] No internal-only hostnames (`*.helloally.dev`, `*.clawstation.ai`, etc.) in code or comments.
- [ ] No real credentials, API keys, or `.env` files committed. Placeholder values only in `.env.example`.
- [ ] No private keys (`.pem`, `.key`, `.pfx`), DB dumps, or scan reports.
- [ ] `gitleaks` (run via pre-commit) reports clean for the diff.
