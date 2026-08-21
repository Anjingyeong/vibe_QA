import path from "node:path";
import { authorizePublicSite, exploreSite } from "../explorer/site-explorer.js";
import { scanBrowser } from "../scanner/browser-scanner.js";
import { reviewRuns } from "../reviewer/evidence-reviewer.js";
import { createNoopDiscoveryAdapter, runAiDiscovery } from "../discovery/ai-discovery.js";
import { buildCustomerReport, renderCustomerReportHtml } from "../report/customer-report.js";

function progress(onProgress, stage, value, message) {
  onProgress?.({ stage, progress: value, message });
}

export function createQuickScanService({
  runCount = 3,
  maxPages = 4,
  discoveryAdapter = createNoopDiscoveryAdapter(),
  authorize = authorizePublicSite,
  explore = exploreSite,
  scan = scanBrowser,
  review = reviewRuns,
  artifactsRoot = path.join("artifacts", "web"),
} = {}) {
  if (!Number.isInteger(runCount) || runCount < 2 || runCount > 5) throw new Error("runCount must be 2..5");
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 10) throw new Error("maxPages must be 1..10");

  return async function runQuickScan(target, { onProgress, scanId = "manual" } = {}) {
    progress(onProgress, "preflight", 8, "공개 HTTPS 대상과 네트워크 경계를 확인하고 있습니다.");
    const policy = await authorize(target);

    progress(onProgress, "explore", 22, "안전한 읽기 전용 탐색으로 주요 페이지와 상호작용 후보를 찾고 있습니다.");
    const exploration = await explore(target, { maxPages });

    progress(onProgress, "browser", 42, "데스크톱·모바일 브라우저 증거를 반복 수집하고 있습니다.");
    const host = new URL(target).hostname.replace(/[^a-z0-9.-]+/giu, "_");
    const runs = [];
    for (let index = 0; index < runCount; index += 1) {
      const value = 42 + Math.round(((index + 1) / runCount) * 36);
      runs.push(await scan(target, {
        screenshotDir: path.join(artifactsRoot, String(scanId), host, `run-${index + 1}`),
        targetPolicy: policy,
      }));
      progress(onProgress, "browser", value, `브라우저 재현성 검증 ${index + 1}/${runCount}`);
    }

    progress(onProgress, "review", 84, "반복 재현과 증거 완전성을 검증하고 있습니다.");
    const reviewed = review(runs);

    progress(onProgress, "discovery", 91, "추가 테스트 후보를 정리하고 있습니다.");
    const discovery = await runAiDiscovery(discoveryAdapter, {
      url: target,
      pages: exploration.pages.map((page) => ({
        url: page.url,
        title: page.title,
        forms: page.forms,
        buttons: page.buttons,
        links: page.links.slice(0, 20),
      })),
    });

    progress(onProgress, "report", 96, "확정 증거와 미확정 후보를 분리해 결과를 만들고 있습니다.");
    const report = buildCustomerReport({
      target,
      reviewed,
      scanMeta: {
        runCount,
        coverage: {
          pagesVisited: exploration.pageCount,
          ...exploration.coverage,
          aiDiscoveryCandidates: discovery.length,
        },
      },
    });

    return {
      report,
      reportHtml: renderCustomerReportHtml(report),
      exploration: {
        target: exploration.target,
        origin: exploration.origin,
        pageCount: exploration.pageCount,
        coverage: exploration.coverage,
        pages: exploration.pages,
      },
      discovery,
      reviewed,
    };
  };
}
