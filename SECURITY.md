# Security

## Scope

`kontxt` is a local-first CLI and MCP server for continuity across AI sessions. The default trust model is:

- data remains on the local machine
- local files under `~/.kontxt/` are the primary storage boundary
- project state files under `.kontxt/` are part of the local repo/worktree

`kontxt` is not a security product. It reduces obvious risks in the local workflow, but it should not be described as formally audited, certified, or zero-trust.

## Current Protections

- local storage by default
- owner-only file permissions for `~/.kontxt` files where supported by the platform
- no cloud sync in the default CLI surface
- `fresh` mode to suppress prior-context injection
- unique-prefix resolution for edit/delete operations
- redaction of obvious token-like values before storing captured content
- refusal to store private key block material through managed write paths
- transcript redaction before sending extraction requests to external providers

## Trust Boundaries

The main trust boundaries are:

1. The local operating system account
2. Any repo that contains `.kontxt/*.md`
3. Any transcript explicitly piped into `capture` or `session end`
4. Any external provider used for extraction or embeddings when configured

If an OpenAI API key is configured, it is stored locally in `~/.kontxt/config.json`.

## Safe Usage Guidance

- Prefer `session start --mode ask` when reviewing carry-forward context matters
- Do not intentionally store secrets, private keys, production credentials, or raw tokens in memory or `.kontxt/*.md`
- Review project-local `.kontxt/*.md` files before committing them to version control
- Treat external extraction backends as data processors for the sanitized transcript you send them

## Known Limits

- `kontxt` does not encrypt the local vault at rest
- `kontxt` does not prevent a privileged local user or malware on the same machine from reading local files
- Redaction is pattern-based and should be treated as a guardrail, not a complete DLP system
- No external security audit has been performed in this repository

## Reporting

If you discover a security issue, do not open a public issue containing exploit details or secrets. Report it privately to the project maintainer.
