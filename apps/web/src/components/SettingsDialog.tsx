"use client";

import { useEffect, useState } from "react";
import { Loader2, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSettings, type HighlightStyle } from "@/store/settings";
import { getAsrCapability, probeVolcengine } from "@/lib/api";
import type { AsrCapabilityResponse, VolcengineProbeResponse } from "@/types";

const FONT_OPTIONS = [
    { label: "系统默认 (Sans-serif)", value: "sans-serif" },
    { label: "思源黑体 (Noto Sans SC)", value: "'Noto Sans SC', sans-serif" },
    { label: "微软雅黑 (Microsoft YaHei)", value: "'Microsoft YaHei', sans-serif" },
    { label: "苹方 (PingFang SC)", value: "'PingFang SC', sans-serif" },
    { label: "系统衬线 (Serif)", value: "serif" },
    { label: "思源宋体 (Noto Serif SC)", value: "'Noto Serif SC', serif" },
    { label: "系统等宽 (Monospace)", value: "monospace" },
    { label: "圆体 (Rounded)", value: "ui-rounded, 'Hiragino Maru Gothic ProN', sans-serif" },
    { label: "Inter", value: "'Inter', sans-serif" },
    { label: "Roboto", value: "'Roboto', sans-serif" },
];

export function SettingsDialog() {
    const settings = useSettings();
    const [open, setOpen] = useState(false);
    const [activeCredTab, setActiveCredTab] = useState("volcengine");
    const [showCredForm, setShowCredForm] = useState(false);
    const [showDiagPanel, setShowDiagPanel] = useState(false);
    const [checkingCapability, setCheckingCapability] = useState(false);
    const [capability, setCapability] = useState<AsrCapabilityResponse | null>(null);
    const [probingVolc, setProbingVolc] = useState(false);
    const [volcProbe, setVolcProbe] = useState<VolcengineProbeResponse | null>(null);
    const [appearanceDraft, setAppearanceDraft] = useState({
        panelFontFamily: settings.panelFontFamily,
        panelFontSize: settings.panelFontSize,
        highlightStyle: settings.highlightStyle,
        playerFontFamily: settings.playerFontFamily,
        playerFontSize: settings.playerFontSize,
    });
    const [blockDraft, setBlockDraft] = useState({
        useReadableBlocks: settings.useReadableBlocks,
        blockMaxCharsZh: settings.blockMaxCharsZh,
        blockMaxCharsEn: settings.blockMaxCharsEn,
        blockMaxLines: settings.blockMaxLines,
        blockMaxDuration: settings.blockMaxDuration,
        blockMinDuration: settings.blockMinDuration,
        blockTolerance: settings.blockTolerance,
    });

    useEffect(() => {
        if (!open) return;
        setAppearanceDraft({
            panelFontFamily: settings.panelFontFamily,
            panelFontSize: settings.panelFontSize,
            highlightStyle: settings.highlightStyle,
            playerFontFamily: settings.playerFontFamily,
            playerFontSize: settings.playerFontSize,
        });
        setBlockDraft({
            useReadableBlocks: settings.useReadableBlocks,
            blockMaxCharsZh: settings.blockMaxCharsZh,
            blockMaxCharsEn: settings.blockMaxCharsEn,
            blockMaxLines: settings.blockMaxLines,
            blockMaxDuration: settings.blockMaxDuration,
            blockMinDuration: settings.blockMinDuration,
            blockTolerance: settings.blockTolerance,
        });
    }, [open, settings.blockMaxCharsEn, settings.blockMaxCharsZh, settings.blockMaxDuration, settings.blockMaxLines, settings.blockMinDuration, settings.blockTolerance, settings.highlightStyle, settings.panelFontFamily, settings.panelFontSize, settings.playerFontFamily, settings.playerFontSize, settings.useReadableBlocks]);

    const applySubtitleSettings = () => {
        settings.setAppearance(appearanceDraft);
        settings.setBlockSettings(blockDraft);
    };

    const handleDetectCapability = async () => {
        setCheckingCapability(true);
        try {
            const result = await getAsrCapability();
            setCapability(result);
        } finally {
            setCheckingCapability(false);
        }
    };

    const handleProbeVolc = async () => {
        setProbingVolc(true);
        try {
            const result = await probeVolcengine();
            setVolcProbe(result);
        } finally {
            setProbingVolc(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="border border-black/70 hover:bg-black hover:text-neon" aria-label="Settings">
                    <Settings className="h-4 w-4" />
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px] border-black bg-canvas">
                <DialogHeader>
                    <DialogTitle className="font-mono uppercase tracking-wide">设置 (Settings)</DialogTitle>
                    <DialogDescription className="text-foreground/70">
                        配置 API 密钥和界面外观
                    </DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="api" className="w-full">
                    <TabsList className="grid w-full grid-cols-4 border border-black/70 bg-white">
                        <TabsTrigger value="api">API 密钥</TabsTrigger>
                        <TabsTrigger value="diag">功能调度/诊断</TabsTrigger>
                        <TabsTrigger value="appearance">外观样式</TabsTrigger>
                        <TabsTrigger value="readable">阅读排版</TabsTrigger>
                    </TabsList>

                    <TabsContent value="api" className="space-y-6 py-4">
                        <div className="space-y-3 rounded-[20px] border border-black/70 bg-white/50 p-4">
                            <Label className="text-base font-semibold">网关访问密钥 (Gateway API Key)</Label>
                            <div className="space-y-2">
                                <Label>API Key</Label>
                                <Input
                                    type="password"
                                    value={settings.gatewayApiKey}
                                    onChange={(e) => settings.setApiKeys({ gatewayApiKey: e.target.value })}
                                    placeholder="可选：用于网关鉴权"
                                    className="border-black bg-white"
                                />
                                <p className="text-xs text-foreground/70">
                                    若网关启用了 API Key 鉴权，请在此填写；将自动附加到所有 /api 请求头。
                                </p>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <Label className="text-base font-semibold">服务商凭据 (Credentials)</Label>
                            <Select
                                value={activeCredTab}
                                onValueChange={(val) => setActiveCredTab(val)}
                            >
                                <SelectTrigger className="border-black bg-white">
                                    <SelectValue placeholder="选择服务商" />
                                </SelectTrigger>
                                <SelectContent className="border-black bg-canvas">
                                    <SelectItem value="volcengine">火山引擎 (Volcengine)</SelectItem>
                                    <SelectItem value="aliyun">阿里云百炼 (Dashscope)</SelectItem>
                                    <SelectItem value="gemini">Google Gemini</SelectItem>
                                    <SelectItem value="deepseek">DeepSeek 官方</SelectItem>
                                </SelectContent>
                            </Select>

                            <div className="flex items-center justify-between rounded-xl border border-black/70 bg-white/50 px-3 py-2">
                                <p className="text-xs text-foreground/70">
                                    服务商凭据表单默认折叠，按需展开
                                </p>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="border-black bg-white hover:bg-black hover:text-white"
                                    onClick={() => setShowCredForm((v) => !v)}
                                >
                                    {showCredForm ? "收起配置" : "展开配置"}
                                </Button>
                            </div>

                            {showCredForm && activeCredTab === "volcengine" && (
                                <div className="space-y-3 rounded-[20px] border border-black/70 bg-white/50 p-4">
                                    <div className="space-y-2">
                                        <Label>App ID</Label>
                                        <Input
                                            type="text"
                                            value={settings.volcengineAppId}
                                            onChange={(e) => settings.setApiKeys({ volcengineAppId: e.target.value })}
                                            placeholder="在此输入 App ID"
                                            className="border-black bg-white"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Access Token</Label>
                                        <Input
                                            type="password"
                                            value={settings.volcengineToken}
                                            onChange={(e) => settings.setApiKeys({ volcengineToken: e.target.value })}
                                            placeholder="在此输入 Token"
                                            className="border-black bg-white"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Secret Key (可选)</Label>
                                        <Input
                                            type="password"
                                            value={settings.volcengineSecretKey}
                                            onChange={(e) => settings.setApiKeys({ volcengineSecretKey: e.target.value })}
                                            placeholder="可选，不填也可用"
                                            className="border-black bg-white"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Resource ID</Label>
                                        <Input
                                            type="text"
                                            value={settings.volcengineMode === "flash" ? "volc.bigasr.auc_turbo" : "volc.seedasr.sauc.duration"}
                                            readOnly
                                            className="border-black bg-white"
                                        />
                                        <p className="text-[11px] text-foreground/70">
                                            按模式固定：nostream=`volc.seedasr.sauc.duration`，flash=`volc.bigasr.auc_turbo`
                                        </p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>接入模式</Label>
                                        <Select
                                            value={settings.volcengineMode}
                                            onValueChange={(val: "bigmodel_nostream" | "flash" | "legacy_auc") => settings.setApiKeys({ volcengineMode: val })}
                                        >
                                            <SelectTrigger className="border-black bg-white">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="border-black bg-canvas">
                                                <SelectItem value="bigmodel_nostream">豆包 nostream</SelectItem>
                                                <SelectItem value="flash">录音极速版 Flash（推荐）</SelectItem>
                                                <SelectItem value="legacy_auc">旧版 AUC (回退)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <p className="text-xs text-foreground/70">用于高精度的语音识别 (ASR)。</p>
                                </div>
                            )}

                            {showCredForm && activeCredTab === "aliyun" && (
                                <div className="space-y-3 rounded-[20px] border border-black/70 bg-white/50 p-4">
                                    <div className="space-y-2">
                                        <Label>API Key</Label>
                                        <Input
                                            type="password"
                                            value={settings.aliyunKey}
                                            onChange={(e) => settings.setApiKeys({ aliyunKey: e.target.value })}
                                            placeholder="sk-..."
                                            className="border-black bg-white"
                                        />
                                    </div>
                                    <p className="text-xs text-foreground/70">支持 SenseVoice 语音识别，及 DeepSeek 模型翻译。</p>
                                </div>
                            )}

                            {showCredForm && activeCredTab === "gemini" && (
                                <div className="space-y-3 rounded-[20px] border border-black/70 bg-white/50 p-4">
                                    <div className="space-y-2">
                                        <Label>API Key</Label>
                                        <Input
                                            type="password"
                                            value={settings.geminiKey}
                                            onChange={(e) => settings.setApiKeys({ geminiKey: e.target.value })}
                                            placeholder="AIza..."
                                            className="border-black bg-white"
                                        />
                                    </div>
                                    <p className="text-xs text-foreground/70">用于极其快速准确的字幕文本翻译。</p>
                                </div>
                            )}

                            {showCredForm && activeCredTab === "deepseek" && (
                                <div className="space-y-3 rounded-[20px] border border-black/70 bg-white/50 p-4">
                                    <div className="space-y-2">
                                        <Label>API Key</Label>
                                        <Input
                                            type="password"
                                            value={settings.deepseekKey}
                                            onChange={(e) => settings.setApiKeys({ deepseekKey: e.target.value })}
                                            placeholder="sk-..."
                                            className="border-black bg-white"
                                        />
                                    </div>
                                    <p className="text-xs text-foreground/70">DeepSeek 官方 API 支持。</p>
                                </div>
                            )}
                        </div>

                    </TabsContent>

                    <TabsContent value="diag" className="space-y-4 py-4">
                        <div className="flex items-center justify-between rounded-xl border border-black/70 bg-white/50 px-3 py-2">
                            <p className="text-xs text-foreground/70">
                                环境检测、火山探测、功能调度默认折叠，按需展开
                            </p>
                            <Button
                                size="sm"
                                variant="outline"
                                className="border-black bg-white hover:bg-black hover:text-white"
                                onClick={() => setShowDiagPanel((v) => !v)}
                            >
                                {showDiagPanel ? "收起诊断面板" : "展开诊断面板"}
                            </Button>
                        </div>

                        {showDiagPanel && (
                            <div className="space-y-4 rounded-[20px] border border-black/70 bg-white/50 p-3">
                                <div className="space-y-2 rounded-[16px] border border-black/50 bg-white/60 p-3">
                                    <div className="flex items-center justify-between">
                                        <Label>环境检测</Label>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="border-black bg-white hover:bg-black hover:text-white"
                                            onClick={handleDetectCapability}
                                            disabled={checkingCapability}
                                        >
                                            {checkingCapability ? (
                                                <>
                                                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                                    检测中
                                                </>
                                            ) : (
                                                "检测"
                                            )}
                                        </Button>
                                    </div>
                                    {capability && (
                                        <div className="space-y-1 text-xs text-foreground/70">
                                            <p>可转写: {capability.capability?.canTranscribe ? "是" : "否"}</p>
                                            <p>本地: {capability.capability?.localReady ? "可用" : "不可用"}（{capability.capability?.localReason || "-"}）</p>
                                            <p>依赖: ffmpeg {capability.capability?.ffmpegReady ? "OK" : "NO"} / ffprobe {capability.capability?.ffprobeReady ? "OK" : "NO"} / yt-dlp {capability.capability?.ytDlpReady ? "OK" : "NO"}</p>
                                            <p>云端: Volc {capability.capability?.cloudAvailable?.volcengine ? "OK" : "NO"} / Aliyun {capability.capability?.cloudAvailable?.aliyun ? "OK" : "NO"}</p>
                                            <p>推荐: {capability.capability?.recommendedProvider || "none"} / 顺序: {(capability.provider_order_auto || []).join(" -> ") || "-"}</p>
                                        </div>
                                    )}
                                </div>

                                <div className="space-y-2 rounded-[16px] border border-black/50 bg-white/60 p-3">
                                    <div className="flex items-center justify-between">
                                        <Label>火山连通性探测</Label>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="border-black bg-white hover:bg-black hover:text-white"
                                            onClick={handleProbeVolc}
                                            disabled={probingVolc}
                                        >
                                            {probingVolc ? (
                                                <>
                                                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                                    探测中
                                                </>
                                            ) : (
                                                "探测"
                                            )}
                                        </Button>
                                    </div>
                                    <p className="text-xs text-foreground/70">
                                        只做 WS 握手+最小请求，不跑完整转写。用于快速确认 AppID/Token/ResourceID 是否有效。
                                    </p>
                                    {volcProbe && (
                                        <div className="space-y-1 text-xs text-foreground/70">
                                            <p>状态: {volcProbe.ok ? "成功" : "失败"} / 模式: {volcProbe.mode || "-"}</p>
                                            <p>资源: {volcProbe.chosenResourceId || "-"}</p>
                                            <p>信息: {volcProbe.message || volcProbe.error || "-"}</p>
                                            {(volcProbe.attempts || []).map((a, idx) => (
                                                <p key={`${a.resourceId}-${idx}`}>
                                                    - {a.resourceId}: {a.ok ? `OK${a.logid ? ` (logid=${a.logid})` : ""}` : `FAIL (${a.error || "unknown"})`}
                                                </p>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div className="space-y-2 rounded-[16px] border border-black/50 bg-white/60 p-3">
                                    <Label className="text-sm font-semibold">功能调度 (Service Routing)</Label>
                                    <div className="space-y-2">
                                        <Label>语音识别 (ASR) 服务商</Label>
                                        <Select
                                            value={settings.asrProvider || "auto"}
                                            onValueChange={(val: "auto" | "volcengine" | "aliyun" | "local") => settings.setApiKeys({ asrProvider: val })}
                                        >
                                            <SelectTrigger className="border-black bg-white">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="border-black bg-canvas">
                                                <SelectItem value="auto">自动 (跟随配置系统依赖)</SelectItem>
                                                <SelectItem value="volcengine">火山引擎 (Volcengine)</SelectItem>
                                                <SelectItem value="aliyun">阿里云百炼 (SenseVoice)</SelectItem>
                                                <SelectItem value="local">本地 (FunASR)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="flex items-center justify-between rounded-[14px] border border-black/60 bg-white/70 p-2.5">
                                        <div>
                                            <p className="text-sm font-medium">允许 ASR 自动降级</p>
                                            <p className="text-xs text-foreground/70">
                                                关闭后将严格使用当前选择的接入模式，不自动切到 Flash 或其它模式。
                                            </p>
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={settings.allowAsrAutoDowngrade}
                                            onChange={(e) => settings.setApiKeys({ allowAsrAutoDowngrade: e.target.checked })}
                                            className="rounded border-black bg-white"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>文本翻译 (Translation) 服务商</Label>
                                        <Select
                                            value={settings.translateProvider || "auto"}
                                            onValueChange={(val: "auto" | "gemini" | "deepseek" | "qwen") => settings.setApiKeys({ translateProvider: val })}
                                        >
                                            <SelectTrigger className="border-black bg-white">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="border-black bg-canvas">
                                                <SelectItem value="auto">自动 (优先 Gemini, 备用目标)</SelectItem>
                                                <SelectItem value="gemini">Gemini</SelectItem>
                                                <SelectItem value="deepseek">DeepSeek 官方</SelectItem>
                                                <SelectItem value="qwen">阿里通义千问 (Qwen)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="appearance" className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>字幕高亮样式</Label>
                            <Select
                                value={appearanceDraft.highlightStyle}
                                onValueChange={(val: HighlightStyle) => setAppearanceDraft((d) => ({ ...d, highlightStyle: val }))}
                            >
                                <SelectTrigger className="border-black bg-white">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="border-black bg-canvas">
                                    <SelectItem value="default">默认 (背景色)</SelectItem>
                                    <SelectItem value="underline">下划线</SelectItem>
                                    <SelectItem value="left-border">左侧边框</SelectItem>
                                    <SelectItem value="glow">发光效果</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>字幕面板字体</Label>
                            <Select
                                value={appearanceDraft.panelFontFamily}
                                onValueChange={(val) => setAppearanceDraft((d) => ({ ...d, panelFontFamily: val }))}
                            >
                                <SelectTrigger className="border-black bg-white">
                                    <SelectValue placeholder="选择字体" />
                                </SelectTrigger>
                                <SelectContent className="border-black bg-canvas">
                                    {FONT_OPTIONS.map((font) => (
                                        <SelectItem
                                            key={font.value}
                                            value={font.value}
                                            style={{ fontFamily: font.value }}
                                        >
                                            {font.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>字幕面板字号</Label>
                            <Input
                                type="text"
                                value={appearanceDraft.panelFontSize}
                                onChange={(e) => setAppearanceDraft((d) => ({ ...d, panelFontSize: e.target.value }))}
                                placeholder="例如: 14px, 1rem"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>视频嵌字字体</Label>
                            <Select
                                value={appearanceDraft.playerFontFamily}
                                onValueChange={(val) => setAppearanceDraft((d) => ({ ...d, playerFontFamily: val }))}
                            >
                                <SelectTrigger className="border-black bg-white">
                                    <SelectValue placeholder="选择字体" />
                                </SelectTrigger>
                                <SelectContent className="border-black bg-canvas">
                                    {FONT_OPTIONS.map((font) => (
                                        <SelectItem
                                            key={font.value}
                                            value={font.value}
                                            style={{ fontFamily: font.value }}
                                        >
                                            {font.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>视频嵌字字号</Label>
                            <Input
                                type="text"
                                value={appearanceDraft.playerFontSize}
                                onChange={(e) => setAppearanceDraft((d) => ({ ...d, playerFontSize: e.target.value }))}
                                placeholder="例如: 24px, 1.5rem"
                            />
                        </div>
                    </TabsContent>

                    <TabsContent value="readable" className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                                <Label>启用智能短句合并 (Dual-Track)</Label>
                                <input
                                    type="checkbox"
                                    checked={blockDraft.useReadableBlocks}
                                    onChange={(e) => setBlockDraft((d) => ({ ...d, useReadableBlocks: e.target.checked }))}
                                    className="rounded border-black bg-white"
                                />
                            </div>
                            <p className="text-xs text-foreground/70">将细碎的短句智能合并为更适合阅读的长句字幕块。</p>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>中日最大字数/行</Label>
                                <Input
                                    type="number"
                                    value={blockDraft.blockMaxCharsZh}
                                    onChange={(e) => setBlockDraft((d) => ({ ...d, blockMaxCharsZh: Number(e.target.value) }))}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>英文最大字符数/行</Label>
                                <Input
                                    type="number"
                                    value={blockDraft.blockMaxCharsEn}
                                    onChange={(e) => setBlockDraft((d) => ({ ...d, blockMaxCharsEn: Number(e.target.value) }))}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>合并上限行数</Label>
                                <Input
                                    type="number"
                                    value={blockDraft.blockMaxLines}
                                    onChange={(e) => setBlockDraft((d) => ({ ...d, blockMaxLines: Number(e.target.value) }))}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>字数溢出容忍度 (0~1)</Label>
                                <Input
                                    type="number"
                                    step="0.05"
                                    value={blockDraft.blockTolerance}
                                    onChange={(e) => setBlockDraft((d) => ({ ...d, blockTolerance: Number(e.target.value) }))}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>最小合并时长 (秒)</Label>
                                <Input
                                    type="number"
                                    step="0.1"
                                    value={blockDraft.blockMinDuration}
                                    onChange={(e) => setBlockDraft((d) => ({ ...d, blockMinDuration: Number(e.target.value) }))}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>最大合并时长 (秒)</Label>
                                <Input
                                    type="number"
                                    step="0.1"
                                    value={blockDraft.blockMaxDuration}
                                    onChange={(e) => setBlockDraft((d) => ({ ...d, blockMaxDuration: Number(e.target.value) }))}
                                />
                            </div>
                        </div>
                    </TabsContent>
                </Tabs>
                <div className="mt-2 flex items-center justify-end gap-2 border-t border-black/60 pt-3">
                    <Button
                        variant="outline"
                        size="sm"
                        className="border-black bg-white hover:bg-black hover:text-white"
                        onClick={() => {
                            setAppearanceDraft({
                                panelFontFamily: "sans-serif",
                                panelFontSize: "14px",
                                highlightStyle: "default",
                                playerFontFamily: "sans-serif",
                                playerFontSize: "24px",
                            });
                            setBlockDraft({
                                useReadableBlocks: true,
                                blockMaxCharsZh: 22,
                                blockMaxCharsEn: 42,
                                blockMaxLines: 2,
                                blockMaxDuration: 4.5,
                                blockMinDuration: 1.2,
                                blockTolerance: 0.15,
                            });
                        }}
                    >
                        重置字幕设置
                    </Button>
                    <Button size="sm" className="border border-black bg-black text-neon hover:bg-black/90" onClick={applySubtitleSettings}>
                        应用字幕设置
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
