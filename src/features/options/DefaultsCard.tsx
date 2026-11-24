import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

type DefaultsCardProps = {
  blur: { en: boolean; zh: boolean };
  continuous: boolean;
  disabled: boolean;
  onBlurChange: (lang: 'en' | 'zh', checked: boolean) => void;
  onContinuousChange: (checked: boolean) => void;
};

type SwitchRowProps = {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
};

function SwitchRow({
  id,
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: SwitchRowProps) {
  return (
    <div className="flex items-start justify-between gap-6 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-1">
        <Label htmlFor={id}>{label}</Label>
        <p id={`${id}-description`} className="m-0 text-xs text-muted-foreground">
          {description}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        aria-describedby={`${id}-description`}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

/** Default subtitle visibility and playback behaviour for every video. */
export function DefaultsCard({
  blur,
  continuous,
  disabled,
  onBlurChange,
  onContinuousChange,
}: DefaultsCardProps) {
  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          字幕与播放默认态
        </CardTitle>
        <CardDescription>
          这些默认值对之后的视频生效；播放器里的临时开关不会改动这里。
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col divide-y divide-border">
        <SwitchRow
          id="blur-en"
          label="模糊英文字幕"
          description="开启后默认遮挡英文字幕，悬停可临时看清；默认关闭。"
          checked={blur.en}
          disabled={disabled}
          onCheckedChange={(checked) => onBlurChange('en', checked)}
        />
        <SwitchRow
          id="blur-zh"
          label="模糊中文字幕"
          description="与英文模糊互相独立；默认关闭。"
          checked={blur.zh}
          disabled={disabled}
          onCheckedChange={(checked) => onBlurChange('zh', checked)}
        />
        <SwitchRow
          id="playback-continuous"
          label="连续播放"
          description="开启后 a / s / d 导航只跳转、不在句尾暂停；关闭时为默认的逐句暂停。"
          checked={continuous}
          disabled={disabled}
          onCheckedChange={onContinuousChange}
        />
      </CardContent>
    </Card>
  );
}
