import type { DesktopAppshotTarget } from "@t3tools/contracts";
import { CircleAlertIcon, XIcon } from "lucide-react";

import type { ComposerImageAttachment } from "../../composerDraftStore";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const PREVIEW_MASK =
  "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.78) 76%, rgba(0,0,0,0) 100%)";

export function PendingAppshotCard({ target }: { target: DesktopAppshotTarget }) {
  return (
    <div
      className="appshot-capture-pending w-[176px] select-none"
      role="status"
      aria-label={`Capturing ${target.appName}`}
    >
      <div className="relative flex h-[106px] items-end justify-center">
        <div
          className="appshot-capture-shimmer h-[94px] w-[164px] overflow-hidden rounded-xl border border-border/70 bg-muted/55 shadow-[0_12px_18px_rgba(0,0,0,0.22)]"
          style={{ WebkitMaskImage: PREVIEW_MASK, maskImage: PREVIEW_MASK }}
        />
        {target.appIconDataUrl ? (
          <img
            src={target.appIconDataUrl}
            alt=""
            aria-hidden
            className="absolute bottom-0 left-1/2 size-7 -translate-x-1/2 object-contain drop-shadow-md"
          />
        ) : null}
      </div>
      <div className="mt-1 truncate text-center text-xs font-medium text-foreground">
        Capturing {target.appName}…
      </div>
    </div>
  );
}

export function AppshotAttachmentCard(props: {
  image: ComposerImageAttachment;
  nonPersisted: boolean;
  onExpand: () => void;
  onRemove: () => void;
}) {
  const appshot = props.image.appshot!;
  const title = appshot.windowTitle?.trim() || appshot.appName;

  return (
    <div className="appshot-capture-settle group/appshot relative w-[176px] select-none">
      <button
        type="button"
        className="block w-full cursor-zoom-in rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Preview Appshot of ${title}`}
        onClick={props.onExpand}
      >
        <div className="relative flex h-[106px] items-end justify-center">
          <div
            className="flex h-[106px] w-[176px] items-end justify-center px-1.5"
            style={{
              filter: "drop-shadow(0 11px 6px rgba(0, 0, 0, 0.28))",
              WebkitMaskImage: PREVIEW_MASK,
              maskImage: PREVIEW_MASK,
            }}
          >
            <img
              src={props.image.previewUrl}
              alt={props.image.name}
              draggable={false}
              className="max-h-[100px] max-w-full rounded-[10px] object-contain"
            />
          </div>
          {appshot.appIconDataUrl ? (
            <img
              src={appshot.appIconDataUrl}
              alt=""
              aria-hidden
              draggable={false}
              className="absolute bottom-0 left-1/2 size-7 -translate-x-1/2 object-contain drop-shadow-md"
            />
          ) : null}
        </div>
        <div className="mt-1 flex min-w-0 items-center justify-center gap-1.5 px-2 text-xs leading-4">
          <span className="truncate font-medium text-foreground">{title}</span>
          {appshot.approval === "supervised" ? (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
              Supervised
            </span>
          ) : null}
        </div>
      </button>

      {props.nonPersisted ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                role="img"
                aria-label="Draft Appshot may not persist"
                className="absolute left-1 top-1 inline-flex items-center justify-center rounded-full bg-background/85 p-1 text-amber-600 shadow-sm backdrop-blur"
              />
            }
          >
            <CircleAlertIcon className="size-3" />
          </TooltipTrigger>
          <TooltipPopup side="top" className="max-w-64 whitespace-normal leading-tight">
            Draft Appshot could not be saved locally and may be lost on navigation.
          </TooltipPopup>
        </Tooltip>
      ) : null}

      <Button
        variant="ghost"
        size="icon-xs"
        className={cn(
          "absolute right-1 top-1 rounded-full bg-background/85 opacity-0 shadow-sm backdrop-blur transition-opacity",
          "group-hover/appshot:opacity-100 focus-visible:opacity-100",
        )}
        onClick={props.onRemove}
        aria-label={`Remove ${props.image.name}`}
      >
        <XIcon />
      </Button>
    </div>
  );
}
