import { Moon, Sun, Subtitles } from "lucide-react";
import { Button } from "@/components/ui/button";

interface HeaderProps {
  theme: "dark" | "light";
  onToggleTheme: () => void;
}

export function Header({ theme, onToggleTheme }: HeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-4">
      <div className="flex items-center gap-2.5">
        <Subtitles className="h-6 w-6 text-primary" />
        <h1 className="text-lg font-semibold tracking-tight">SubPlayer</h1>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          视频字幕识别 &amp; 翻译
        </span>
      </div>

      <Button variant="ghost" size="icon" onClick={onToggleTheme} aria-label="切换主题">
        {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </Button>
    </header>
  );
}
