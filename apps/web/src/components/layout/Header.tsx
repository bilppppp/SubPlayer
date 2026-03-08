"use client";

import { Moon, Sun, Subtitles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "next-themes";
import Link from "next/link";
import { SettingsDialog } from "@/components/SettingsDialog";
import { cn } from "@/lib/utils";

interface HeaderProps {
  variant?: "default" | "retro";
}

export function Header({ variant = "default" }: HeaderProps) {
  const { theme, setTheme } = useTheme();
  const isRetro = variant === "retro";

  return (
    <header
      className={cn(
        "sticky top-0 z-50 flex h-14 shrink-0 items-center justify-between px-4",
        isRetro
          ? "border-b border-black/70 bg-canvas/95 backdrop-blur-sm"
          : "border-b border-border/50 bg-background/80 backdrop-blur-xl"
      )}
    >
      <Link href="/" className="flex items-center gap-2.5">
        <div
          className={cn(
            "flex h-8 w-8 items-center justify-center",
            isRetro ? "rounded-xl border border-black bg-black" : "rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500"
          )}
        >
          <Subtitles className={cn("h-4 w-4", isRetro ? "text-neon" : "text-white")} />
        </div>
        <h1 className={cn("text-lg font-semibold tracking-tight", isRetro ? "font-mono uppercase tracking-[0.14em]" : "")}>SubPlayer</h1>
      </Link>

      <div className="flex items-center gap-2">

        <SettingsDialog />
        {!isRetro && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label="切换主题"
          >
            <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          </Button>
        )}
      </div>
    </header>
  );
}
