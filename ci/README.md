# CI

`juzt-windows.yml` is the Windows build workflow for Juzt (typecheck + unit tests,
then `electron-builder --win --x64 --publish never` on `windows-latest`, uploading
the EXEs as the `Juzt-Windows` artifact).

It lives in BOTH places: `.github/workflows/build.yml` is the live workflow and
this copy is the reference kept in the repo (the GitHub App used by this session
may not be able to edit files under `.github/workflows/` — if a push is rejected,
copy this file there manually).

If the live workflow ever goes missing, restore it by

```bash
mv ci/juzt-windows.yml .github/workflows/build.yml
git commit -m "CI: build Juzt for Windows" && git push
```

or paste the file contents into `.github/workflows/build.yml` in the GitHub UI.
No secrets are required: the workflow never publishes, it only uploads artifacts.
