import { triageRuntimeEvents } from "../../scanner/flow-regressions.js";
import { validateCleanup } from "./cleanup.js";

const evidence = (detail) => [{ type: "assertion", detail }];
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const responsePath = (method, pathname) => (response) =>
  response.request().method() === method && new URL(response.url()).pathname === pathname;

export class ObservedDefect extends Error {
  constructor(message, machineEvidence = evidence(message)) {
    super(message);
    this.name = "ObservedDefect";
    this.machineEvidence = machineEvidence;
  }
}

export function createActions(state) {
  const { pages, target, sanitizer, profile, events } = state;
  return {
    async "first-load"() {
      const ready = pages.host.locator("main").waitFor({ state: "visible" });
      const response = await pages.host.goto(target, { waitUntil: "domcontentloaded" }); await ready;
      expect(response?.ok(), `document status=${response?.status() ?? "none"}`);
      return evidence(`document status=${response.status()}`);
    },
    async "room-create"() {
      const page = pages.host;
      await page.getByRole("button", { name: /친구와 하기/u }).click();
      await page.locator("#room-name").fill("VibeCheckHost");
      const pending = page.waitForResponse(responsePath("POST", "/api/rooms"));
      await page.getByRole("button", { name: "방 만들기" }).click();
      const response = await pending; const payload = await response.json();
      expect(response.status() === 201 && payload.room?.code && payload.playerToken, "room creation failed");
      state.room = { code: sanitizer.register(payload.room.code, "room-code"),
        token: sanitizer.register(payload.playerToken, "player-token") };
      await page.getByText(/친구를 기다리는 중/u).waitFor();
      return evidence("room created status=201; credentials redacted");
    },
    async "room-join"() {
      const page = pages.guest; await page.goto(target, { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: /친구와 하기/u }).click();
      await page.getByRole("tab", { name: "코드 입력" }).click();
      await page.locator("#room-name").fill("VibeCheckGuest");
      await page.locator("#room-code").fill(state.room.code);
      const pending = page.waitForResponse((response) => response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/join"));
      await page.getByRole("button", { name: /방 입장|입장/u }).click();
      const response = await pending; expect(response.ok(), `room join status=${response.status()}`);
      await page.getByText(/2명 참가/u).waitFor();
      return evidence(`guest joined status=${response.status()}; credentials redacted`);
    },
    async "solo-start"() {
      const page = pages.solo; await page.goto(target, { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: /혼자 시작/u }).click();
      await page.locator(".game-page").waitFor(); state.active = page;
      state.songSources = [await page.locator('iframe[title*="SongSong"]').getAttribute("src")];
      return evidence("solo game became visible");
    },
    async "song-start"() {
      await state.active.getByText("재생 준비가 끝났습니다.", { exact: true }).waitFor();
      await state.active.getByRole("button", { name: /음악 재생/u }).click();
      await state.active.locator('[role="status"]').getByText(/재생하고 있습니다/u).waitFor();
      return evidence("playback state changed after subscribed action");
    },
    async "answer-submit"() {
      await state.active.locator("#answer").fill("__vibecheck_invalid_answer__");
      await state.active.getByRole("button", { name: "정답!" }).click();
      await state.active.locator(".feedback-panel").waitFor();
      return evidence("answer submission produced feedback");
    },
    async "next-song"() {
      await state.active.getByRole("button", { name: /바로 다음 곡|바로 결과 보기/u }).click();
      await state.active.getByText("ROUND 02", { exact: false }).waitFor();
      state.songSources.push(await state.active.locator('iframe[title*="SongSong"]').getAttribute("src"));
      return evidence("round advanced to ROUND 02");
    },
    async "duplicate-song"() {
      const sources = state.songSources.filter(Boolean);
      expect(new Set(sources).size === sources.length, "duplicate song source observed");
      return evidence(`observed ${sources.length} song sources; no report endpoint mutated`);
    },
    async refresh() {
      await state.active.reload({ waitUntil: "domcontentloaded" }); await state.active.locator("main").waitFor();
      return evidence("application rendered after refresh");
    },
    async back() {
      await state.active.goto(`${target}/#/terms`, { waitUntil: "domcontentloaded" });
      await state.active.getByText("이용약관", { exact: true }).waitFor();
      await state.active.goBack({ waitUntil: "domcontentloaded" }); await state.active.locator("main").waitFor();
      return evidence("browser Back returned to application");
    },
    async "invalid-input"() {
      const page = state.active; await page.goto(target, { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: /친구와 하기/u }).click();
      await page.getByRole("tab", { name: "코드 입력" }).click(); await page.locator("#room-name").fill("Invalid");
      await page.locator("#room-code").fill("ZZZZZZ");
      const pending = page.waitForResponse((response) => response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/join"));
      await page.getByRole("button", { name: /방 입장|입장/u }).click(); const response = await pending;
      expect(response.status() >= 400 && response.status() < 500, `invalid input status=${response.status()}`);
      state.expectedUrls.add(sanitizer.text(response.url())); return evidence(`invalid input status=${response.status()}`);
    },
    async "missing-route"() {
      const response = await state.active.goto(`${target}/__vibecheck_missing__`, { waitUntil: "domcontentloaded" });
      const status = response?.status() ?? 0;
      state.expectedUrls.add(sanitizer.text(response?.url() ?? `${target}/__vibecheck_missing__`));
      if (status !== 404) {
        throw new ObservedDefect(`missing route status=${status}`,
          [{ type: "network", detail: `GET /__vibecheck_missing__ -> ${status}` }]);
      }
      return evidence("missing route status=404");
    },
    async "missing-api"() {
      await state.active.goto(target, { waitUntil: "domcontentloaded" });
      const result = await state.active.evaluate(async () => { const response = await fetch("/api/__vibecheck_missing__");
        return { status: response.status, url: response.url }; });
      state.expectedUrls.add(sanitizer.text(result.url));
      if (result.status !== 404) {
        throw new ObservedDefect(`missing API status=${result.status}`,
          [{ type: "network", detail: `GET /api/__vibecheck_missing__ -> ${result.status}` }]);
      }
      return evidence("missing API status=404");
    },
    async "mobile-viewport"() {
      const size = await state.active.evaluate(() => ({ width: innerWidth, height: innerHeight,
        clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
      expect(size.width === profile.viewport.width && size.height === profile.viewport.height, "viewport differs from profile");
      expect(size.scrollWidth <= size.clientWidth + 1, "horizontal overflow detected");
      return evidence(`viewport=${size.width}x${size.height}; no horizontal overflow`);
    },
    async "runtime-errors"() {
      const candidates = events.filter((event) => event.type === "pageerror" || event.type === "requestfailed" ||
        (event.type === "console" && event.level === "error") || (event.type === "response" && event.status >= 400))
        .map((event) => state.expectedUrls.has(event.url ?? event.source) ? { ...event, expectedStatus: event.status } : event);
      const result = triageRuntimeEvents(candidates);
      if (result.unexpected.length) {
        throw new ObservedDefect(`${result.unexpected.length} unexpected runtime errors`,
          result.unexpected.map((event) => ({ type: event.type === "console" ? "console" : "network",
            detail: sanitizer.text(JSON.stringify(event)) })));
      }
      return evidence(`runtime events=${events.length}; unexpected errors=0`);
    },
    async cleanup() {
      if (state.room) {
        await validateCleanup(async ({ code, token }) => state.active.evaluate(async (room) => {
          const response = await fetch(`/api/rooms/${room.code}`, { method: "DELETE",
            headers: { authorization: `Bearer ${room.token}` } });
          return { status: response.status, body: await response.text() };
        }, { code, token }), state.room);
        state.room = null;
      }
      return evidence("disposable room deletion validated");
    },
  };
}
