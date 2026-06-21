import { useEffect, useMemo, useRef, useState } from "react";
import InputPanel from "./components/InputPanel";
import EditorPanel from "./components/EditorPanel";
import PreviewPanel from "./components/PreviewPanel";
import HistoryPanel from "./components/HistoryPanel";
import AnalysisPanel from "./components/AnalysisPanel";
import type { ArticleAnalysis, Block, GenParams, HistoryItem, Platform, ProcessReport, Source } from "./lib/types";
import {
  analyzeArticle,
  illustrate,
  streamNDJSON,
  extractArticleLive,
  rewrite,
  cleanup,
  getEgressIp,
  getKeys,
  type RewriteMode,
} from "./lib/api";
import { downloadAllImages } from "./lib/exporters";
import {
  buildBlocks,
  blocksToMarkdown,
  countImages,
  countWords,
  moveBlock,
  removeBlock,
  uid,
} from "./lib/blocks";
import { deleteHistory, loadHistory, upsertHistory } from "./lib/storage";

type StrategySnapshot = NonNullable<HistoryItem["strategy"]>;

export default function App() {
  const [title, setTitle] = useState("");
  const [platform, setPlatform] = useState<Platform>("wechat");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [createdAt, setCreatedAt] = useState<number | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [currentStrategy, setCurrentStrategy] = useState<StrategySnapshot | null>(null);
  const [analysis, setAnalysis] = useState<ArticleAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [processReport, setProcessReport] = useState<ProcessReport | null>(null);

  const [loading, setLoading] = useState(false);
  const [illustrating, setIllustrating] = useState(false);
  const [busyImgId, setBusyImgId] = useState<string | null>(null);
  const [busyMdId, setBusyMdId] = useState<string | null>(null);
  const [genProgress, setGenProgress] = useState<{ phase: string; text: string } | null>(null);
  const [imgProgress, setImgProgress] = useState<{ done: number; total: number; phase: string } | null>(null);
  const [pubProgress, setPubProgress] = useState<{ done: number; total: number; phase: string } | null>(null);
  const [ipModal, setIpModal] = useState<{ ip: string; note?: string; loading?: boolean } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dsKey, setDsKey] = useState("");
  const [amKey, setAmKey] = useState("");
  const [tvKey, setTvKey] = useState("");

  function openSettings() {
    setDsKey(localStorage.getItem("moxie_deepseek_key") || "");
    setAmKey(localStorage.getItem("moxie_apimart_key") || "");
    setTvKey(localStorage.getItem("moxie_tavily_key") || "");
    setSettingsOpen(true);
  }
  function saveSettings() {
    localStorage.setItem("moxie_deepseek_key", dsKey.trim());
    localStorage.setItem("moxie_apimart_key", amKey.trim());
    localStorage.setItem("moxie_tavily_key", tvKey.trim());
    setSettingsOpen(false);
    flash("已保存到本浏览器");
  }
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [toast, setToast] = useState<string>("");
  const [theme, setTheme] = useState<"light" | "dark">(
    () => (localStorage.getItem("moxie_theme") as "light" | "dark") || "light"
  );
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("moxie_theme", theme);
  }, [theme]);

  function cancelStream() {
    abortRef.current?.abort();
  }

  useEffect(() => setHistory(loadHistory()), []);

  const wordCount = useMemo(() => countWords(blocks), [blocks]);
  const imageCount = useMemo(() => countImages(blocks), [blocks]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 2200);
  }

  function persist(next: {
    id: string;
    title: string;
    platform: Platform;
    blocks: Block[];
    createdAt: number;
    strategy?: StrategySnapshot | null;
    sources?: Source[];
    analysis?: ArticleAnalysis | null;
    processReport?: ProcessReport | null;
  }) {
    const item: HistoryItem = {
      id: next.id,
      title: next.title,
      platform: next.platform,
      blocks: next.blocks,
      wordCount: countWords(next.blocks),
      imageCount: countImages(next.blocks),
      createdAt: next.createdAt,
      strategy: next.strategy ?? currentStrategy ?? undefined,
      sources: next.sources ?? sources,
      analysis: next.analysis ?? analysis,
      processReport: next.processReport ?? processReport,
    };
    setHistory(upsertHistory(item));
  }

  function snapshotStrategy(p: GenParams): StrategySnapshot {
    return {
      viewpoint: p.viewpoint,
      experience: p.experience,
      uncertainty: p.uncertainty,
      reflection: p.reflection,
      reference: p.reference,
      webSearch: p.webSearch,
      probeQuestions: p.probeQuestions || [],
    };
  }

  function buildProcessReport(p: GenParams, usedSources: Source[]): ProcessReport {
    const sourceCount = usedSources.filter((s) => s.type !== "error").length;
    return {
      humanInputs: [
        `核心观点：${p.viewpoint}`,
        `真实观察 / 经验：${p.experience}`,
        `仍不确定的问题：${p.uncertainty}`,
        p.reflection ? `补充回答：${p.reflection}` : "补充回答：未填写",
      ],
      aiContributions: [
        "把人的观点组织成适合目标平台的文章结构",
        "根据文章语境生成开头 / 中间 / 结尾的配图场景",
        "对正文进行质量评估、事实/推论/观点分层和表达诊断",
        p.probeQuestions?.length ? "在写作前提出追问，帮助补齐反例、证据和读者价值" : "未使用生成前追问",
      ],
      decisionPoints: [
        "关键事实需要优先核对来源，不能把模型推测当成事实",
        "强观点需要能对应人的真实观察或项目经验",
        "不确定的问题保留为边界条件，而不是被包装成确定结论",
        `本次写作使用了 ${sourceCount} 条可展示来源`,
      ],
      reviewChecklist: [
        "每个日期、数字、产品名称是否有来源",
        "文章里哪些句子是事实，哪些是推论，哪些是个人观点",
        "是否存在空泛套话、过度拔高或强行金句",
        "读者看完是否能得到一个可复用判断或行动建议",
      ],
    };
  }

  async function runAnalysis(args: {
    id: string;
    title: string;
    platform: Platform;
    blocks: Block[];
    createdAt: number;
    strategy: StrategySnapshot;
    sources: Source[];
    processReport: ProcessReport;
  }) {
    setAnalysisLoading(true);
    try {
      const result = await analyzeArticle({
        title: args.title,
        article: blocksToMarkdown(args.blocks, args.title),
        platform: args.platform,
        strategy: args.strategy,
        sources: args.sources,
      });
      setAnalysis(result);
      persist({
        id: args.id,
        title: args.title,
        platform: args.platform,
        blocks: args.blocks,
        createdAt: args.createdAt,
        strategy: args.strategy,
        sources: args.sources,
        analysis: result,
        processReport: args.processReport,
      });
      flash("质量评估已完成");
    } catch (e: any) {
      flash("质量评估失败：" + (e?.message || e));
    } finally {
      setAnalysisLoading(false);
    }
  }

  async function handleGenerate(p: GenParams) {
    setLoading(true);
    setSources([]);
    const strategy = snapshotStrategy(p);
    setCurrentStrategy(strategy);
    setAnalysis(null);
    setProcessReport(null);
    setGenProgress({ phase: "连接 DeepSeek…", text: "" });
    const ac = new AbortController();
    abortRef.current = ac;
    let raw = "";
    let final: { title: string; article: string; image_scenes: any[] } | null = null;
    let usedSources: Source[] = [];
    try {
      for await (const ev of streamNDJSON("/api/generate/stream", { ...p, ...getKeys() }, ac.signal)) {
        if (ev.type === "phase") {
          setGenProgress((pr) => ({ phase: ev.phase, text: pr?.text || "" }));
        } else if (ev.type === "sources") {
          usedSources = ev.sources || [];
          setSources(usedSources);
        } else if (ev.type === "delta") {
          raw += ev.text;
          const live = extractArticleLive(raw);
          setGenProgress({ phase: live ? "正在撰写正文…" : "构思标题与结构…", text: live });
        } else if (ev.type === "done") {
          final = { title: ev.title, article: ev.article, image_scenes: ev.image_scenes };
        } else if (ev.type === "error") {
          throw new Error(ev.error);
        }
      }
      if (!final) throw new Error("未收到完整结果");
      const newBlocks = buildBlocks(final.article, final.image_scenes);
      const id = uid();
      const ts = Date.now();
      setTitle(final.title);
      setPlatform(p.platform);
      setBlocks(newBlocks);
      setCreatedAt(ts);
      setDocId(id);
      const report = buildProcessReport(p, usedSources);
      setProcessReport(report);
      persist({
        id,
        title: final.title,
        platform: p.platform,
        blocks: newBlocks,
        createdAt: ts,
        strategy,
        sources: usedSources,
        analysis: null,
        processReport: report,
      });
      void runAnalysis({
        id,
        title: final.title,
        platform: p.platform,
        blocks: newBlocks,
        createdAt: ts,
        strategy,
        sources: usedSources,
        processReport: report,
      });
      flash("文章已生成，可点「为文章配图」补插画");
    } catch (e: any) {
      if (e?.name === "AbortError") {
        // 中断时保留已写出的正文为草稿
        const live = extractArticleLive(raw);
        if (live) {
          const nb: Block[] = [{ id: uid(), type: "markdown", content: live }];
          const id = uid();
          const ts = Date.now();
          setTitle(p.title);
          setPlatform(p.platform);
          setBlocks(nb);
          setCreatedAt(ts);
          setDocId(id);
          const report = buildProcessReport(p, usedSources);
          setProcessReport(report);
          persist({
            id,
            title: p.title,
            platform: p.platform,
            blocks: nb,
            createdAt: ts,
            strategy,
            sources: usedSources,
            analysis: null,
            processReport: report,
          });
          flash("已停止，保留为草稿");
        } else {
          flash("已停止生成");
        }
      } else {
        flash("生成失败：" + (e?.message || e));
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
      setGenProgress(null);
    }
  }

  async function handleIllustrate() {
    const imgBlocks = blocks.filter((b): b is Extract<Block, { type: "image" }> => b.type === "image");
    const scenes = imgBlocks.map((b) => b.scene).filter(Boolean);
    if (scenes.length === 0) {
      flash("没有可用的配图场景");
      return;
    }
    setIllustrating(true);
    setImgProgress({ done: 0, total: scenes.length, phase: "正在提交出图任务…" });
    const ac = new AbortController();
    abortRef.current = ac;
    let images: { url: string }[] = [];
    try {
      for await (const ev of streamNDJSON("/api/illustrate/stream", { scenes, ...getKeys() }, ac.signal)) {
        if (ev.type === "progress") {
          setImgProgress({ done: ev.done, total: ev.total, phase: ev.phase });
        } else if (ev.type === "done") {
          images = ev.images;
        } else if (ev.type === "error") {
          throw new Error(ev.error);
        }
      }
      // 按场景顺序回填到 image block
      let k = 0;
      const next = blocks.map((b) => {
        if (b.type !== "image") return b;
        const img = images[k++];
        if (!img) return b;
        return { ...b, url: img.url, status: "done" as const };
      });
      setBlocks(next);
      if (docId && createdAt) persist({ id: docId, title, platform, blocks: next, createdAt });
      flash(`已配图 ${images.length} 张`);
    } catch (e: any) {
      if (e?.name === "AbortError") flash("已停止配图");
      else flash("配图失败：" + (e?.message || e));
    } finally {
      abortRef.current = null;
      setIllustrating(false);
      setImgProgress(null);
    }
  }

  function updateBlocks(next: Block[]) {
    setBlocks(next);
    if (docId && createdAt) persist({ id: docId, title, platform, blocks: next, createdAt });
  }

  function editMarkdown(id: string, content: string) {
    updateBlocks(
      blocks.map((b) => (b.id === id && b.type === "markdown" ? { ...b, content } : b))
    );
  }

  async function rewriteBlock(id: string, mode: RewriteMode) {
    const b = blocks.find((x) => x.id === id);
    if (!b || b.type !== "markdown" || !b.content.trim()) return;
    setBusyMdId(id);
    try {
      const { text } = await rewrite(b.content, mode);
      updateBlocks(blocks.map((x) => (x.id === id && x.type === "markdown" ? { ...x, content: text } : x)));
      flash("已用 AI 改写该段");
    } catch (e: any) {
      flash("改写失败：" + (e?.message || e));
    } finally {
      setBusyMdId(null);
    }
  }

  async function showEgressIp() {
    setIpModal({ ip: "", loading: true });
    try {
      const ip = await getEgressIp();
      setIpModal({ ip });
    } catch (e: any) {
      setIpModal({ ip: "", note: "查询失败：" + (e?.message || e) });
    }
  }

  async function handlePublish() {
    if (!blocks.length) return;
    if (!blocks.some((b) => b.type === "image" && b.url)) {
      flash("公众号草稿需要封面：请先为文章配至少 1 张图");
      return;
    }
    if (platform !== "wechat" && !window.confirm("当前平台不是微信公众号，仍要发布到公众号草稿箱吗？")) return;
    if (!window.confirm("将把这篇图文推送到你的公众号【草稿箱】（不会自动群发，可在后台删除）。确定继续吗？"))
      return;
    setPubProgress({ done: 0, total: 1, phase: "准备发布…" });
    try {
      let draftId = "";
      for await (const ev of streamNDJSON("/api/publish/stream", { title, blocks })) {
        if (ev.type === "progress") setPubProgress({ done: ev.done, total: ev.total, phase: ev.phase });
        else if (ev.type === "done") draftId = ev.draft_media_id;
        else if (ev.type === "error") throw new Error(ev.error);
      }
      flash("✅ 已推送到公众号草稿箱，去后台→草稿箱查看并群发");
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (/whitelist|40164/.test(msg)) {
        const ip = msg.match(/invalid ip ([\d.]+)/)?.[1] || "";
        setIpModal({ ip, note: "微信拒绝了这个 IP，请把它加入公众号「IP 白名单」后重试。" });
      } else {
        flash("发布失败：" + msg);
      }
    } finally {
      setPubProgress(null);
    }
  }

  async function handleDownloadAll() {
    try {
      const n = await downloadAllImages(blocks, title || "墨写文章");
      flash(n ? `开始下载 ${n} 张图片` : "暂无可下载的图片");
    } catch (e: any) {
      flash("下载失败：" + (e?.message || e));
    }
  }

  async function handleCleanup() {
    if (!window.confirm("将删除服务器上未被任何文章引用的配图文件。\n此操作不可恢复，确定继续吗？")) return;
    // 收集历史 + 当前所有仍在使用的图片 URL，删掉服务器上其余未引用的配图目录
    const used = new Set<string>();
    for (const it of loadHistory())
      for (const b of it.blocks) if (b.type === "image" && b.url) used.add(b.url);
    for (const b of blocks) if (b.type === "image" && b.url) used.add(b.url);
    try {
      const { removed } = await cleanup([...used]);
      flash(removed ? `已清理 ${removed} 组无用配图` : "没有可清理的无用配图");
    } catch (e: any) {
      flash("清理失败：" + (e?.message || e));
    }
  }

  function addMarkdownAfter(id: string) {
    const i = blocks.findIndex((b) => b.id === id);
    if (i < 0) return;
    const nb: Block = { id: uid(), type: "markdown", content: "" };
    updateBlocks([...blocks.slice(0, i + 1), nb, ...blocks.slice(i + 1)]);
  }

  function splitMarkdown(id: string, pos: number) {
    const i = blocks.findIndex((b) => b.id === id);
    if (i < 0) return;
    const b = blocks[i];
    if (b.type !== "markdown") return;
    const before = b.content.slice(0, pos).trimEnd();
    const after = b.content.slice(pos).trimStart();
    if (!after) return; // 光标在末尾，无需拆分
    const next = blocks.slice();
    next.splice(
      i,
      1,
      { ...b, content: before },
      { id: uid(), type: "markdown", content: after }
    );
    updateBlocks(next);
    flash("已拆分为两个文字块");
  }

  async function regenerateImage(id: string) {
    const b = blocks.find((x) => x.id === id);
    if (!b || b.type !== "image" || !b.scene) return;
    setBusyImgId(id);
    try {
      const res = await illustrate([b.scene]);
      const img = res.images[0];
      if (img) {
        const next = blocks.map((x) =>
          x.id === id && x.type === "image" ? { ...x, url: img.url, status: "done" as const } : x
        );
        setBlocks(next);
        if (docId && createdAt) persist({ id: docId, title, platform, blocks: next, createdAt });
        flash("已重新生成这张图");
      }
    } catch (e: any) {
      flash("重新生成失败：" + (e?.message || e));
    } finally {
      setBusyImgId(null);
    }
  }

  function handleCopy() {
    const md = blocksToMarkdown(blocks, title);
    navigator.clipboard.writeText(md).then(
      () => flash("已复制最终 Markdown"),
      () => flash("复制失败，请手动选择")
    );
  }

  function handleRestore(item: HistoryItem) {
    setTitle(item.title);
    setPlatform(item.platform);
    setBlocks(item.blocks);
    setCreatedAt(item.createdAt);
    setDocId(item.id);
    setCurrentStrategy(item.strategy || null);
    setSources(item.sources || []);
    setAnalysis(item.analysis || null);
    setProcessReport(item.processReport || null);
    flash("已恢复历史文章");
  }

  function handleDelete(id: string) {
    setHistory(deleteHistory(id));
    if (id === docId) {
      setBlocks([]);
      setTitle("");
      setCreatedAt(null);
      setDocId(null);
      setCurrentStrategy(null);
      setSources([]);
      setAnalysis(null);
      setProcessReport(null);
    }
  }

  function handleReanalyze() {
    if (!blocks.length || !docId || !createdAt) {
      flash("当前没有可评估的文章");
      return;
    }
    const strategy =
      currentStrategy || {
        viewpoint: "未记录",
        experience: "未记录",
        uncertainty: "未记录",
        reflection: "",
        reference: "",
        webSearch: false,
        probeQuestions: [],
      };
    const report =
      processReport ||
      buildProcessReport(
        {
          title,
          platform,
          type: "",
          audience: "",
          tone: "",
          length: "medium",
          viewpoint: strategy.viewpoint,
          experience: strategy.experience,
          uncertainty: strategy.uncertainty,
          reflection: strategy.reflection,
          reference: strategy.reference,
          webSearch: strategy.webSearch,
          probeQuestions: strategy.probeQuestions,
        },
        sources
      );
    setProcessReport(report);
    void runAnalysis({
      id: docId,
      title,
      platform,
      blocks,
      createdAt,
      strategy,
      sources,
      processReport: report,
    });
  }

  return (
    <div className="app">
      <aside className="col col-left">
        <InputPanel
          loading={loading}
          onGenerate={handleGenerate}
          theme={theme}
          onToggleTheme={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
          onOpenSettings={openSettings}
        />
        <HistoryPanel
          items={history}
          activeId={docId}
          sources={sources}
          onRestore={handleRestore}
          onDelete={handleDelete}
          onCleanup={handleCleanup}
        />
      </aside>

      <main className="col col-mid">
        <EditorPanel
          blocks={blocks}
          illustrating={illustrating}
          busyImgId={busyImgId}
          busyMdId={busyMdId}
          genProgress={genProgress}
          imgProgress={imgProgress}
          pubProgress={pubProgress}
          onCancel={cancelStream}
          onPublish={handlePublish}
          onShowIp={showEgressIp}
          onMove={(id, dir) => updateBlocks(moveBlock(blocks, id, dir))}
          onRemove={(id) => updateBlocks(removeBlock(blocks, id))}
          onEditMarkdown={editMarkdown}
          onAddBelow={addMarkdownAfter}
          onSplit={splitMarkdown}
          onRegen={regenerateImage}
          onRewrite={rewriteBlock}
          onIllustrate={handleIllustrate}
          onCopy={handleCopy}
          onDownloadAll={handleDownloadAll}
        />
      </main>

      <section className="col col-right">
        <PreviewPanel
          title={title}
          blocks={blocks}
          wordCount={wordCount}
          imageCount={imageCount}
          createdAt={createdAt}
          onToast={flash}
        />
        <AnalysisPanel
          analysis={analysis}
          loading={analysisLoading}
          processReport={processReport}
          strategy={currentStrategy}
          sources={sources}
          onAnalyze={handleReanalyze}
          onToast={flash}
        />
      </section>

      {toast && <div className="toast">{toast}</div>}

      {settingsOpen && (
        <div className="modal-mask" onClick={() => setSettingsOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">⚙️ 设置 · 你自己的 API Key</div>
            <div className="modal-steps" style={{ marginTop: 0 }}>
              Key 只保存在<b>你这台浏览器</b>，仅用于直接调用对应服务——用谁的 key 就计谁的费用，不会上传或共享。
            </div>

            <label className="set-label">
              DeepSeek API Key（写文章用，必填）
              <a href="https://platform.deepseek.com/" target="_blank" rel="noreferrer">获取 ↗</a>
            </label>
            <input
              className="text-input"
              style={{ width: "100%", margin: "0 0 14px" }}
              type="password"
              placeholder="sk-..."
              value={dsKey}
              onChange={(e) => setDsKey(e.target.value)}
            />

            <label className="set-label">
              Apimart API Key（自动配图用，选填）
              <a href="https://apimart.ai/" target="_blank" rel="noreferrer">获取 ↗</a>
            </label>
            <input
              className="text-input"
              style={{ width: "100%", margin: "0 0 16px" }}
              type="password"
              placeholder="不配图可留空"
              value={amKey}
              onChange={(e) => setAmKey(e.target.value)}
            />

            <label className="set-label">
              Tavily API Key（联网检索实时新闻用，选填）
              <a href="https://tavily.com/" target="_blank" rel="noreferrer">获取 ↗</a>
            </label>
            <input
              className="text-input"
              style={{ width: "100%", margin: "0 0 16px" }}
              type="password"
              placeholder="不联网检索可留空"
              value={tvKey}
              onChange={(e) => setTvKey(e.target.value)}
            />

            <div className="modal-actions">
              <button className="ghost-btn" onClick={() => setSettingsOpen(false)}>取消</button>
              <button className="primary-btn" style={{ margin: 0 }} onClick={saveSettings}>保存</button>
            </div>
          </div>
        </div>
      )}

      {ipModal && (
        <div className="modal-mask" onClick={() => setIpModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">公众号 IP 白名单</div>
            {ipModal.note && <div className="modal-note">{ipModal.note}</div>}
            {ipModal.loading ? (
              <div className="modal-ip">查询中…</div>
            ) : ipModal.ip ? (
              <>
                <div className="modal-ip-label">当前出口 IP（微信看到的就是它）</div>
                <div className="modal-ip">{ipModal.ip}</div>
                <button
                  className="primary-btn modal-copy"
                  onClick={() => {
                    navigator.clipboard.writeText(ipModal.ip);
                    flash("已复制 IP：" + ipModal.ip);
                  }}
                >
                  ⧉ 复制 IP
                </button>
              </>
            ) : (
              <div className="modal-ip" style={{ fontSize: 14, color: "var(--text-2)" }}>未获取到 IP</div>
            )}
            <div className="modal-steps">
              添加路径：公众号后台 → 设置与开发 → 基本配置 → <b>IP 白名单</b> → 修改 →
              <b>只保留当前这个 IP</b>（删掉旧的）→ 保存并管理员扫码确认。
              <br />
              注意：该白名单实际只有一个 IP 生效，换网络（家↔公司）或家用 IP 变动后需重新更新。频繁切换建议用固定 IP 代理（方案 B）。
            </div>
            <div className="modal-actions">
              <a
                className="ghost-btn"
                href="https://mp.weixin.qq.com/"
                target="_blank"
                rel="noreferrer"
              >
                打开公众号后台 ↗
              </a>
              <button className="ghost-btn" onClick={() => setIpModal(null)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
