# download.versatiles.org

[![Code Coverage](https://codecov.io/gh/versatiles-org/download.versatiles.org/branch/main/graph/badge.svg?token=IDHAI13M0K)](https://codecov.io/gh/versatiles-org/download.versatiles.org)
[![GitHub Workflow Status)](https://img.shields.io/github/actions/workflow/status/versatiles-org/download.versatiles.org/ci.yml)](https://github.com/versatiles-org/download.versatiles.org/actions/workflows/ci.yml)

## Project Outline

This project is part of [VersaTiles](https://versatiles.org/) and builds the server behind [download.versatiles.org](https://download.versatiles.org/).

## How to improve the frontend?

Before starting, ensure you have Node.js (>= 20.x) installed. Then run:

```bash
# Clone the repository
git clone https://github.com/versatiles-org/download.versatiles.org.git
cd download.versatiles.org

# Install dependencies
npm install

# Run the development server
npm run dev
```

Now you can edit [`template/index.html`](https://github.com/versatiles-org/download.versatiles.org/blob/main/template/index.html) and reload the page (`http://localhost:8080`) in your browser.

## Architecture

This project uses Docker Compose to run a Nginx server. The server serves:
- `*.versatiles` files from an external storage mounted using sshfs.
- Most requested `*.versatiles` files are synced to the SSD of the server to improve download speed.
- The front page `index.html` generated with Node.js.
- URL lists for automated [Google Cloud Storage Transfer](https://cloud.google.com/storage-transfer/docs/create-url-list) of the form `urllist_*.tsv` are generated with Node.js.

The Nginx server configuration is also generated with Node.js.

The most import files and folders in this repo are:
- [`compose.yaml`](https://github.com/versatiles-org/download.versatiles.org/blob/main/compose.yaml) defines a Nginx service.
- [`src/lib/run.ts`](https://github.com/versatiles-org/download.versatiles.org/blob/main/src/lib/run.ts) defines all steps to scan for files, sync them, generate HTML, generate URL lists and generate the Nginx configuration.
- [`src/server.ts`](https://github.com/versatiles-org/download.versatiles.org/blob/main/src/server.ts) is basically just a webhook.
- [`scripts/run.sh`](https://github.com/versatiles-org/download.versatiles.org/blob/main/scripts/run.sh) starts Nginx using Docker Compose and runs `src/server.ts` in a loop.
- [`template`](https://github.com/versatiles-org/download.versatiles.org/tree/main/template) contains [Handlebars.js](https://handlebarsjs.com/) templates to generate HTML, Nginx config and URL lists.

## Available Scripts

Here are some of the most commonly used scripts:

- **`npm run check`**: Runs both linting and testing.
- **`npm run dev`**: Starts the development server.
- **`npm run lint`**: Checks the codebase for linting errors using ESLint.
- **`npm run once`**: Runs a one-time script (`run_once.ts`).
- **`npm run server`**: Starts the server.
- **`npm run test`**: Runs tests using Jest.
- **`npm run test-coverage`**: Runs tests and generates a coverage report.
- **`npm run upgrade`**: Updates dependencies.

## Running Tests

To run the tests, use the following command:

```bash
npm run test
```

For coverage reports:

```bash
npm run test-coverage
```

## Contributing

Contributions are welcome! Please submit a pull request or open an issue for any improvements or bugs you find.

## License

This project is licensed under the MIT License.
