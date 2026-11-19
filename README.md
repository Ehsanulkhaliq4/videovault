# VideoVault Downloader

VideoVault Downloader is a cross-platform desktop video downloader built with Electron, Angular, and Quarkus. It provides a native desktop shell for downloading videos using a local backend service and `yt-dlp` integration.

## Features

- Native Electron desktop app UI
- Angular frontend for responsive experience
- Quarkus-based backend runner for fast local processing
- Video info lookup and download start via backend API
- Support for packaged distribution with AppImage and `.deb`

## Repository Structure

- `src/` - Electron main and preload scripts
- `frontend/` - Angular frontend source and build output
- `resources/quarkus-backend/yt-downloader-backend-runner` - native Quarkus backend executable
- `icons/` - application icon assets
- `package.json` - Electron app scripts and packaging configuration

## Prerequisites

- Node.js (recommended v18+ or newer)
- npm
- Java / Quarkus build environment if you need to rebuild the backend

## Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the app in development mode:
   ```bash
   npm start
   ```

3. Open the Electron window and use the app UI. The backend runner should start automatically.

## Build / Package

Build the distributable app using Electron Builder:

```bash
npm run dist
```

This command produces packaged output in the `dist/` directory.

## Download

After building, upload the generated installer files from `dist/` to a GitHub release. On GitHub, create a new release and attach the packaged assets such as:

- `*.AppImage`
- `*.deb`

Then add the release link to your repository so viewers can download the app directly from GitHub.

For example:

1. Build the app:
   ```bash
   npm run dist
   ```
2. Open `dist/` and confirm generated files.
3. Create a GitHub release and attach the `AppImage` / `.deb` assets.
4. Share the release URL in your repo description and README.

Example download entry for GitHub:

> Download the latest release from the [Releases](https://github.com/Ehsanulkhaliq4/videovault/releases) page.

### Direct download

You can distribute your packaged desktop app from GitHub Releases:

- `VideoVault Downloader-1.0.0.AppImage` for Linux users
- `vediovault_downloader_1.0.0_amd64.deb` for Debian/Ubuntu users

If you also want a mirror, add a secondary download link from a file host such as Realme File, Google Drive, or Dropbox.

For example:

> Download the latest release from the [GitHub Releases](https://github.com/Ehsanulkhaliq4/videovault/releases) page.

## Notes

- The app frontend is loaded from `frontend/dist/yt-downloader-ui/browser/index.html` when packaged.
- The native backend runner is expected at `resources/quarkus-backend/yt-downloader-backend-runner`.
- The build configuration includes `icons/**/*` so the application icon assets are bundled.

## Usage

1. Launch the app.
2. Wait for the backend service to start.
3. Enter a video URL and choose a download format.
4. Start the download through the UI.

## Troubleshooting

- If the app stays on the loading screen, make sure the backend binary exists and is executable.
- If packaging fails, verify your Node version and Electron Builder compatibility.
- The UI now shows the backend's real error message instead of only `400 Bad Request`.
  Read that message first — it usually identifies the exact problem.
- `Cannot start yt-dlp ...`: the bundled `resources/bin/<platform>/yt-dlp` is
  missing or was not unpacked with executable permissions. Reinstall/rebuild the
  app. The Linux binary is a self-contained executable, so Python is **not**
  required on the target machine.
- `yt-dlp failed (exit 1): ... Sign in to confirm you're not a bot` (or HTTP 403):
  YouTube is rate-limiting that network. Try another network, or set the
  environment variable `YTDLP_EXTRA_ARGS` (for example
  `--extractor-args youtube:player_client=web`) before launching the app.
- After changing Java code in `yt-downloader-backend`, rebuild the native runner
  (`./mvnw package -Dnative`) and copy it to
  `resources/quarkus-backend/yt-downloader-backend-runner` before packaging.
  The Electron launcher exports `YTDLP_PATH`/`YTDLP_BINARY` with the absolute
  path of the bundled yt-dlp; the backend reads these at runtime.

## License

ISC
