export type Platform = "wechat" | "woshipm";

export interface GenParams {
  title: string;
  platform: Platform;
  type: string; // 文章类型
  audience: string; // 目标读者
  tone: string; // 语气风格
  length: "short" | "medium" | "long";
  viewpoint: string; // 人的核心观点
  experience: string; // 人的真实观察/项目经验
  uncertainty: string; // 人还不确定的问题
  reflection?: string; // 对 AI 追问的补充回答
  probeQuestions?: string[]; // 生成前的 AI 追问
  reference?: string; // 参考资料/事实（可填文字或链接），用于杜绝幻觉
  webSearch?: boolean; // 是否联网检索实时新闻（需 Tavily key）
}

export interface ImageScene {
  position: string; // 开头/中间/结尾
  scene: string; // 画面描述
}

// 撰稿时实际用到的事实来源，供用户核对（联网检索 / 抓取链接 / 手动资料）
export interface Source {
  type: "search" | "link" | "note" | "error";
  title: string;
  url: string;
}

export interface ProbeReport {
  questions: string[];
  evidenceNeeds: string[];
  angles: string[];
}

export interface QualityMetric {
  key: string;
  label: string;
  score: number; // 1-5
  verdict: string;
  suggestion: string;
}

export interface FactOpinionItem {
  text: string;
  type: "fact" | "inference" | "opinion";
  support: "supported" | "needs_source" | "human_judgment";
  note: string;
  suggestion: string;
}

export interface ExpressionIssue {
  text: string;
  issue: string;
  suggestion: string;
  severity: "low" | "medium" | "high";
}

export interface ArticleAnalysis {
  summary: string;
  quality: QualityMetric[];
  factOpinion: FactOpinionItem[];
  expression: ExpressionIssue[];
  nextActions: string[];
}

export interface ProcessReport {
  humanInputs: string[];
  aiContributions: string[];
  decisionPoints: string[];
  reviewChecklist: string[];
}

export type Block =
  | { id: string; type: "markdown"; content: string }
  | {
      id: string;
      type: "image";
      url: string; // 为空表示尚未生成
      caption: string;
      scene: string; // 画面描述（也是出图 prompt 主体）
      position: string;
      status: "pending" | "done";
    };

export interface HistoryItem {
  id: string;
  title: string;
  platform: Platform;
  blocks: Block[];
  wordCount: number;
  imageCount: number;
  createdAt: number;
  strategy?: Pick<
    GenParams,
    "viewpoint" | "experience" | "uncertainty" | "reflection" | "reference" | "webSearch" | "probeQuestions"
  >;
  sources?: Source[];
  analysis?: ArticleAnalysis | null;
  processReport?: ProcessReport | null;
}
