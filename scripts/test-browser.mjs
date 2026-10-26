import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright";

const build = spawnSync(process.execPath, ["esbuild.config.mjs", "browser"], { stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

const root = resolve(".");
const server = createServer((request, response) => {
	try {
		const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
		const file = resolve(root, `.${pathname}`);
		if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
		const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };
		response.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream");
		response.end(readFileSync(file));
	} catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
	// CI installs the pinned Chromium. Local Windows development may reuse Chrome
	// when browser downloads are unavailable, without touching an existing session.
	const channel = process.env.PLAYWRIGHT_CHANNEL || (!existsSync(chromium.executablePath()) && process.platform === "win32" ? "chrome" : undefined);
	browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
	console.log(`Browser checks: ${channel ?? "Chromium"}`);
	const origin = `http://127.0.0.1:${server.address().port}`;
	for (const suite of ["review", "doi", "maintenance"]) {
		const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
		const page = await context.newPage();
		const errors = [];
		page.on("pageerror", error => errors.push(error.message));
		await page.route("**/*", route => route.request().url().startsWith(origin + "/") ? route.continue() : route.abort());
		try {
			await page.goto(`${origin}/.cache/build/browser/${suite}.html`);
			await page.waitForFunction(() => document.body.dataset.result, null, { timeout: 30000 });
			const result = await page.evaluate(() => ({ state: document.body.dataset.result, text: document.body.innerText }));
			if (result.state !== "passed" || errors.length) throw new Error(`${result.text}\n${errors.join("\n")}`);
			console.log(`${suite}: ${result.text}`);
		} catch (error) {
			await page.screenshot({ path: `.cache/build/browser/${suite}-failure.png`, fullPage: true });
			throw error;
		} finally { await context.close(); }
	}
} finally {
	await browser?.close();
	await new Promise(resolve => server.close(resolve));
}
