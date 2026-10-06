# CI

`juzt-windows.yml` is the Windows build workflow for Juzt (typecheck + unit tests,
then `electron-builder --win --x64 --publish never` on `windows-latest`, uploading
the EXEs as the `Juzt-Windows` artifact).

It lives here rather than in `.github/workflows/` because the GitHub App used by
this session does not carry the `workflows` permission, and GitHub rejects any push
that creates or edits a file under `.github/workflows/`.

To activate it, either

```bash
mv ci/juzt-windows.yml .github/workflows/build.yml
git commit -m "CI: build Juzt for Windows" && git push
```

or paste the file contents into `.github/workflows/build.yml` in the GitHub UI.
No secrets are required: the workflow never publishes, it only uploads artifacts.
