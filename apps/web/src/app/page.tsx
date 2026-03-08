"use client";

import { motion } from "framer-motion";
import {
  Subtitles,
  Languages,
  Zap,
  Globe,
  Download,
  Chrome,
  ArrowRight,
  Play,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.42 },
  }),
};

const features = [
  { icon: Zap, title: "AI 语音识别", desc: "多语种识别，时间轴精确到句级片段。" },
  { icon: Languages, title: "智能翻译", desc: "支持双语字幕与目标语言转换。" },
  { icon: Globe, title: "多源输入", desc: "YouTube / Bilibili / 直链 / 本地文件。" },
  { icon: Subtitles, title: "实时同步", desc: "播放器嵌字 + 右侧字幕栏联动高亮。" },
  { icon: Download, title: "格式导出", desc: "SRT / VTT / JSON / Markdown / TXT。" },
  { icon: Chrome, title: "插件协同", desc: "链接收藏、预处理、播放列表模式。" },
];

export default function LandingPage() {
  return (
    <div className="retro-app min-h-dvh">
      <nav className="sticky top-0 z-50 border-b border-black/70 bg-canvas/90 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-black bg-black">
              <Subtitles className="h-4 w-4 text-neon" />
            </div>
            <span className="font-mono text-base font-bold uppercase tracking-[0.16em] text-void">SubPlayer</span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/app">
              <Button className="border border-black bg-black text-neon hover:bg-black/90">
                开始使用
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      <section className="mx-auto max-w-6xl px-4 pb-20 pt-16 md:pt-24">
        <motion.div initial="hidden" animate="visible" className="flex flex-col items-center text-center">
          <motion.div variants={fadeUp} custom={0}>
            <div className="mb-6 inline-flex items-center gap-1.5 rounded-full border border-black/70 bg-white/55 px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-void/75">
              <Sparkles className="h-3 w-3 text-void" />
              AI VIDEO SUBTITLE WORKSTATION
            </div>
          </motion.div>

          <motion.h1 variants={fadeUp} custom={1} className="max-w-4xl text-4xl font-black tracking-tight text-void sm:text-5xl md:text-6xl">
            让每一段视频
            <span className="mx-2 inline-block rounded-xl bg-black px-3 py-0.5 text-neon">可读</span>
            也可听懂
          </motion.h1>

          <motion.p variants={fadeUp} custom={2} className="mt-6 max-w-2xl text-base leading-relaxed text-void/70 sm:text-lg">
            上传视频或粘贴链接，自动生成时间轴字幕并翻译。支持多平台输入与多格式导出，
            面向“看完即走”与“批量预处理”两种工作流。
          </motion.p>

          <motion.div variants={fadeUp} custom={3} className="mt-8 flex gap-3">
            <Link href="/app">
              <Button size="lg" className="border border-black bg-black text-neon hover:bg-black/90">
                <Play className="mr-2 h-4 w-4" />
                立即体验
              </Button>
            </Link>
          </motion.div>
        </motion.div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20">
        <div className="inverted-corner retro-card overflow-hidden p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between border-b border-black/60 pb-3">
            <div className="font-mono text-xs uppercase tracking-wider text-void/70">Realtime Preview</div>
            <div className="rounded-full border border-black/70 bg-white px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-void">System Online</div>
          </div>
          <div className="grid gap-4 md:grid-cols-[1.6fr_1fr]">
            <div className="relative aspect-video overflow-hidden rounded-[24px] border-2 border-black bg-black">
              <div className="absolute bottom-12 left-0 right-0 flex justify-center px-3">
                <span className="max-w-[82%] rounded-xl border border-white/25 bg-black/88 px-3 py-1.5 text-center text-sm text-white">
                  Powered by state-of-the-art AI models
                </span>
              </div>
              <div className="absolute bottom-5 left-0 right-0 flex justify-center px-3">
                <span className="max-w-[82%] rounded-xl border border-neon/60 bg-black/75 px-2.5 py-1 text-center text-xs text-neon">
                  由最先进的 AI 模型驱动
                </span>
              </div>
            </div>
            <div className="rounded-[24px] border border-black/70 bg-white/55 p-3">
              <div className="mb-2 border-b border-black/40 pb-2">
                <span className="font-mono text-xs uppercase tracking-wider text-void">Subtitle List · 4</span>
              </div>
              <div className="space-y-1.5">
                {["00:03", "00:07", "00:12", "00:16"].map((t, i) => (
                  <div key={t} className={`rounded-xl px-2 py-1.5 ${i === 1 ? "bg-neon/30 ring-1 ring-black/40" : "bg-white/55"}`}>
                    <div className="font-mono text-[10px] uppercase tracking-wide text-void/60">{t}</div>
                    <div className="text-[12px] text-void">{["Welcome to the future of video subtitles", "Powered by state-of-the-art AI models", "Supporting over 50 languages worldwide", "Export in any format you need"][i]}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-24">
        <div className="mb-10 text-center">
          <h2 className="text-3xl font-black tracking-tight text-void sm:text-4xl">为什么选择 SubPlayer</h2>
          <p className="mt-3 text-void/70">识别、翻译、播放、导出，一条链路完成。</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05 }}
              className="retro-card rounded-[26px] p-5"
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl border border-black bg-black text-neon">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="mb-2 font-semibold text-void">{f.title}</h3>
              <p className="text-sm leading-relaxed text-void/70">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <footer className="border-t border-black/60 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-4 text-center">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md border border-black bg-black text-neon">
              <Subtitles className="h-3 w-3" />
            </div>
            <span className="font-mono text-xs uppercase tracking-[0.14em] text-void">SubPlayer</span>
          </div>
          <p className="text-xs text-void/65">AI-powered video subtitle recognition and translation</p>
        </div>
      </footer>
    </div>
  );
}
