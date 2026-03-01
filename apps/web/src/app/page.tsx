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
  Sun,
  Moon,
  Play,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "next-themes";
import Link from "next/link";

// ── Animation variants ──────────────────────────────────────────────
const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] as const },
  }),
};

const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};

// ── Features ────────────────────────────────────────────────────────
const features = [
  {
    icon: Zap,
    title: "AI 语音识别",
    desc: "基于 FunASR 大模型，支持中/英/日/韩等多语种，精准识别每一个字",
    gradient: "from-amber-500 to-orange-500",
  },
  {
    icon: Languages,
    title: "智能翻译",
    desc: "Gemini 2.0 驱动的专业字幕翻译，保持原文语境和语义",
    gradient: "from-blue-500 to-cyan-500",
  },
  {
    icon: Globe,
    title: "全平台支持",
    desc: "YouTube、Bilibili、本地文件，直链 URL — 一个入口搞定所有",
    gradient: "from-emerald-500 to-teal-500",
  },
  {
    icon: Subtitles,
    title: "实时字幕同步",
    desc: "播放视频时字幕实时高亮，双语对照显示，点击即可跳转",
    gradient: "from-indigo-500 to-purple-500",
  },
  {
    icon: Download,
    title: "多格式导出",
    desc: "一键导出 SRT、WebVTT、JSON 格式，支持包含译文的双语字幕",
    gradient: "from-pink-500 to-rose-500",
  },
  {
    icon: Chrome,
    title: "Chrome 扩展",
    desc: "浏览器侧边栏直接生成字幕，无需离开视频页面（即将推出）",
    gradient: "from-violet-500 to-fuchsia-500",
  },
];

// ── Demo subtitle data ──────────────────────────────────────────────
const demoSubtitles = [
  { time: "00:03", text: "Welcome to the future of video subtitles", translation: "欢迎来到视频字幕的未来", active: false },
  { time: "00:07", text: "Powered by state-of-the-art AI models", translation: "由最先进的 AI 模型驱动", active: true },
  { time: "00:12", text: "Supporting over 50 languages worldwide", translation: "支持全球超过 50 种语言", active: false },
  { time: "00:16", text: "Export in any format you need", translation: "以您需要的任何格式导出", active: false },
];

export default function LandingPage() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="relative min-h-dvh overflow-hidden bg-background text-foreground">
      {/* ── Background effects ──────────────────────────────────────── */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        {/* Main gradient orb */}
        <div className="absolute -top-[40%] left-1/2 h-[80vh] w-[80vh] -translate-x-1/2 rounded-full bg-gradient-to-br from-indigo-500/20 via-purple-500/10 to-transparent blur-3xl" />
        {/* Secondary orb */}
        <div className="absolute -bottom-[20%] -right-[10%] h-[60vh] w-[60vh] rounded-full bg-gradient-to-tl from-cyan-500/10 via-blue-500/5 to-transparent blur-3xl" />
        {/* Grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
            backgroundSize: "64px 64px",
          }}
        />
      </div>

      {/* ── Nav ─────────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 border-b border-border/50 bg-background/60 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 shadow-lg shadow-indigo-500/25">
              <Subtitles className="h-4 w-4 text-white" />
            </div>
            <span className="text-lg font-semibold tracking-tight">SubPlayer</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            </Button>
            <Link href="/app">
              <Button className="bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 hover:from-indigo-600 hover:to-purple-600">
                开始使用
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────── */}
      <section className="relative mx-auto max-w-6xl px-4 pb-20 pt-20 md:pt-32">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="flex flex-col items-center text-center"
        >
          {/* Badge */}
          <motion.div variants={fadeUp} custom={0}>
            <div className="mb-6 inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/50 px-3 py-1 text-xs text-muted-foreground backdrop-blur-sm">
              <Sparkles className="h-3 w-3 text-indigo-500" />
              AI 驱动的视频字幕工具
            </div>
          </motion.div>

          {/* Headline */}
          <motion.h1
            variants={fadeUp}
            custom={1}
            className="max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl lg:text-7xl"
          >
            <span className="block">让每一段视频</span>
            <span className="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-transparent">
              开口说任何语言
            </span>
          </motion.h1>

          {/* Subheadline */}
          <motion.p
            variants={fadeUp}
            custom={2}
            className="mt-6 max-w-xl text-base text-muted-foreground sm:text-lg"
          >
            上传视频或粘贴链接，AI 自动识别语音、生成带时间轴的双语字幕。
            <br className="hidden sm:inline" />
            支持 YouTube、Bilibili、本地文件，一键导出 SRT/VTT。
          </motion.p>

          {/* CTA */}
          <motion.div variants={fadeUp} custom={3} className="mt-8 flex gap-3">
            <Link href="/app">
              <Button
                size="lg"
                className="bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-xl shadow-indigo-500/25 hover:shadow-indigo-500/40 hover:from-indigo-600 hover:to-purple-600"
              >
                <Play className="mr-2 h-4 w-4" />
                立即体验
              </Button>
            </Link>
            <Button size="lg" variant="outline">
              了解更多
            </Button>
          </motion.div>

          {/* ── Interactive Demo ────────────────────────────────────── */}
          <motion.div
            variants={fadeUp}
            custom={4}
            className="mt-16 w-full max-w-4xl"
          >
            <div className="overflow-hidden rounded-2xl border border-border/50 bg-card/80 shadow-2xl shadow-black/10 backdrop-blur-xl">
              {/* Fake window bar */}
              <div className="flex items-center gap-2 border-b border-border/50 bg-muted/30 px-4 py-2.5">
                <div className="flex gap-1.5">
                  <div className="h-3 w-3 rounded-full bg-red-500/60" />
                  <div className="h-3 w-3 rounded-full bg-yellow-500/60" />
                  <div className="h-3 w-3 rounded-full bg-green-500/60" />
                </div>
                <div className="mx-auto flex items-center gap-1.5 rounded-md bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
                  <Subtitles className="h-3 w-3" />
                  SubPlayer — AI Subtitle Generator
                </div>
              </div>

              {/* Demo content */}
              <div className="flex flex-col md:flex-row">
                {/* Left: video placeholder */}
                <div className="flex-1 p-4">
                  <div className="relative aspect-video overflow-hidden rounded-xl bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900">
                    {/* Fake video progress */}
                    <div className="absolute bottom-0 left-0 right-0 flex items-center gap-2 bg-gradient-to-t from-black/80 to-transparent px-3 py-2">
                      <div className="h-1 flex-1 rounded-full bg-white/20">
                        <motion.div
                          className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500"
                          initial={{ width: "0%" }}
                          animate={{ width: "35%" }}
                          transition={{ duration: 3, ease: "easeInOut", repeat: Infinity, repeatType: "reverse" }}
                        />
                      </div>
                      <span className="font-mono text-[10px] text-white/60">0:07 / 0:25</span>
                    </div>

                    {/* Fake subtitle overlay */}
                    <div className="absolute bottom-10 left-0 right-0 flex flex-col items-center gap-0.5 px-3">
                      <motion.span
                        animate={{ opacity: [0.9, 1, 0.9] }}
                        transition={{ duration: 2, repeat: Infinity }}
                        className="rounded-lg bg-black/75 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm sm:text-sm"
                      >
                        Powered by state-of-the-art AI models
                      </motion.span>
                      <span className="rounded-lg bg-black/60 px-2 py-0.5 text-[10px] text-amber-300 backdrop-blur-sm sm:text-xs">
                        由最先进的 AI 模型驱动
                      </span>
                    </div>

                    {/* Play icon */}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 backdrop-blur-sm">
                        <Play className="h-5 w-5 text-white/80" />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right: subtitle list */}
                <div className="w-full border-t border-border/50 md:w-72 md:border-l md:border-t-0">
                  <div className="border-b border-border/50 px-3 py-2">
                    <span className="text-xs font-semibold text-foreground">字幕列表</span>
                    <span className="ml-2 text-[10px] text-muted-foreground">4 条</span>
                  </div>
                  <div className="flex flex-col gap-0.5 p-2">
                    {demoSubtitles.map((sub, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.8 + i * 0.15 }}
                        className={`flex gap-2 rounded-lg px-2 py-1.5 ${
                          sub.active
                            ? "bg-indigo-500/10 ring-1 ring-indigo-500/20"
                            : ""
                        }`}
                      >
                        <span className={`shrink-0 font-mono text-[10px] ${sub.active ? "text-indigo-500" : "text-muted-foreground"}`}>
                          {sub.time}
                        </span>
                        <div className="min-w-0">
                          <p className={`text-[11px] leading-relaxed ${sub.active ? "font-medium" : "text-foreground/70"}`}>
                            {sub.text}
                          </p>
                          <p className="text-[10px] text-amber-500/80">{sub.translation}</p>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      </section>

      {/* ── Features ────────────────────────────────────────────────── */}
      <section className="relative mx-auto max-w-6xl px-4 py-24">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-14 text-center"
        >
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            为什么选择{" "}
            <span className="bg-gradient-to-r from-indigo-500 to-purple-500 bg-clip-text text-transparent">
              SubPlayer
            </span>
          </h2>
          <p className="mt-3 text-muted-foreground">
            一站式视频字幕解决方案，从识别到翻译再到导出
          </p>
        </motion.div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feat, i) => (
            <motion.div
              key={feat.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
              className="group relative overflow-hidden rounded-2xl border border-border/50 bg-card/50 p-6 backdrop-blur-sm transition-all hover:border-border hover:bg-card/80 hover:shadow-lg"
            >
              <div
                className={`mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${feat.gradient} shadow-lg`}
                style={{ boxShadow: `0 4px 20px -4px` }}
              >
                <feat.icon className="h-5 w-5 text-white" />
              </div>
              <h3 className="mb-2 font-semibold tracking-tight">{feat.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{feat.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── CTA Section ─────────────────────────────────────────────── */}
      <section className="relative mx-auto max-w-6xl px-4 py-24">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          className="relative overflow-hidden rounded-3xl border border-border/50 bg-gradient-to-br from-indigo-500/10 via-purple-500/5 to-transparent p-8 sm:p-14"
        >
          {/* Decorative gradient */}
          <div className="absolute -right-20 -top-20 h-60 w-60 rounded-full bg-gradient-to-br from-indigo-500/20 to-purple-500/20 blur-3xl" />

          <div className="relative flex flex-col items-center text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              准备好让 AI 为你生成字幕了吗？
            </h2>
            <p className="mt-3 max-w-md text-muted-foreground">
              无需注册，免费使用。上传文件或粘贴链接即刻开始。
            </p>
            <Link href="/app" className="mt-8">
              <Button
                size="lg"
                className="bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-xl shadow-indigo-500/25 hover:shadow-indigo-500/40 hover:from-indigo-600 hover:to-purple-600"
              >
                <Play className="mr-2 h-4 w-4" />
                免费开始
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </motion.div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <footer className="border-t border-border/50 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 text-center">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-indigo-500 to-purple-500">
              <Subtitles className="h-3 w-3 text-white" />
            </div>
            <span className="text-sm font-semibold">SubPlayer</span>
          </div>
          <p className="text-xs text-muted-foreground">
            AI-powered video subtitle recognition &amp; translation
          </p>
        </div>
      </footer>
    </div>
  );
}
