import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { DEFAULT_PROVIDER_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef } from "react";

import { usePrimarySettings } from "../hooks/useSettings";
import { newMessageId, newThreadId } from "../lib/utils";
import { resolveDefaultProviderModelSelection } from "../providerInstances";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useAllEnvironmentShellsBootstrapped, useProjects } from "../state/entities";
import { primaryServerProvidersAtom } from "../state/server";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { waitForStartedServerThread } from "./ChatView.logic";
import {
  findDesktopUpdateSourceProject,
  readDesktopUpdateConflictDispatch,
  resolveDesktopUpdateConflict,
  writeDesktopUpdateConflictDispatch,
} from "./desktopUpdateConflict.logic";
import { useDesktopUpdateState } from "../state/desktopUpdate";
import { stackedThreadToast, toastManager } from "./ui/toast";

/**
 * Turns a source-update conflict into one real, running chat task. Mounting at
 * the authenticated root makes the behavior independent of which update entry
 * point produced the conflict (Settings, either sidebar, or the app menu).
 */
export function DesktopUpdateConflictDispatcher() {
  const updateState = useDesktopUpdateState();
  const conflict = resolveDesktopUpdateConflict(updateState);
  const projects = useProjects();
  const projectsBootstrapped = useAllEnvironmentShellsBootstrapped();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const providers = useAtomValue(primaryServerProvidersAtom);
  const fallbackModelSelection = usePrimarySettings(
    (settings) => settings.textGenerationModelSelection,
  );
  const startThreadTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const navigate = useNavigate();
  const inFlightSignatureRef = useRef<string | null>(null);
  const reportedUnavailableSignatureRef = useRef<string | null>(null);

  const sourceProject = conflict
    ? findDesktopUpdateSourceProject(projects, primaryEnvironmentId, conflict.repositoryPath)
    : null;
  const modelSelection = resolveDefaultProviderModelSelection(
    providers,
    sourceProject?.defaultModelSelection ?? fallbackModelSelection,
  );

  const dispatchConflict = useEffectEvent(async () => {
    if (!conflict || !projectsBootstrapped) return;
    if (readDesktopUpdateConflictDispatch(window.localStorage)?.signature === conflict.signature) {
      return;
    }
    if (inFlightSignatureRef.current === conflict.signature) return;

    if (!sourceProject || !modelSelection) {
      if (reportedUnavailableSignatureRef.current !== conflict.signature) {
        reportedUnavailableSignatureRef.current = conflict.signature;
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not start conflict resolution",
            description: sourceProject
              ? "No ready coding provider is available for the Equinox source project."
              : "Add the Equinox source checkout as a project in this local environment, then retry the update.",
          }),
        );
      }
      return;
    }

    inFlightSignatureRef.current = conflict.signature;
    const threadId = newThreadId();
    const createdAt = new Date().toISOString();
    const result = await startThreadTurn({
      environmentId: sourceProject.environmentId,
      input: {
        threadId,
        message: {
          messageId: newMessageId(),
          role: "user",
          text: conflict.prompt,
          attachments: [],
        },
        modelSelection,
        titleSeed: conflict.title,
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        bootstrap: {
          createThread: {
            projectId: sourceProject.id,
            title: conflict.title,
            modelSelection,
            runtimeMode: DEFAULT_RUNTIME_MODE,
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            branch: null,
            worktreePath: null,
            createdAt,
          },
        },
        createdAt,
      },
    });

    if (result._tag === "Failure") {
      inFlightSignatureRef.current = null;
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not send conflict resolution task",
            description: error instanceof Error ? error.message : "Thread creation failed.",
          }),
        );
      }
      return;
    }

    writeDesktopUpdateConflictDispatch(window.localStorage, {
      signature: conflict.signature,
      environmentId: sourceProject.environmentId,
      threadId,
    });
    const threadRef = scopeThreadRef(sourceProject.environmentId, threadId);
    await waitForStartedServerThread(threadRef, 5_000);
    await navigate({
      to: "/$environmentId/$threadId",
      params: {
        environmentId: sourceProject.environmentId,
        threadId,
      },
    });
    toastManager.add(
      stackedThreadToast({
        type: "success",
        title: "Conflict resolution started",
        description: "The Equinox rebase conflicts were sent to a running chat task.",
      }),
    );
  });

  useEffect(() => {
    if (!conflict || !projectsBootstrapped) return;
    void dispatchConflict();
  }, [
    conflict?.signature,
    modelSelection?.instanceId,
    modelSelection?.model,
    projectsBootstrapped,
    sourceProject?.id,
  ]);

  return null;
}
