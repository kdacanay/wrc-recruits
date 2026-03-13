// EmailAssignedAgentPopover.jsx

export default function EmailAssignedAgentPopover({
  open,
  onClose,
  onSend,
  agentEmail,
  previewSubject,
  previewBody,
}) {
  if (!open) return null;

  return (
    <div className="absolute right-0 mt-2 w-[420px] z-50 rounded-xl border bg-white shadow-xl">
      
      <div className="border-b px-4 py-3">
        <div className="text-sm font-semibold">
          Email assigned agent?
        </div>
        <div className="text-xs text-gray-500">
          Draft will open for {agentEmail || "(no email)"}.
        </div>
      </div>

      <div className="px-4 py-3">
        <div className="text-xs font-semibold text-gray-600">Subject</div>
        <div className="mt-1 rounded border bg-gray-50 px-2 py-1 text-sm">
          {previewSubject}
        </div>

        <div className="mt-3 text-xs font-semibold text-gray-600">Message</div>
        <pre className="mt-1 max-h-40 overflow-auto rounded border bg-gray-50 px-2 py-1 text-sm whitespace-pre-wrap">
          {previewBody}
        </pre>
      </div>

      <div className="flex justify-end gap-2 border-t px-4 py-3">
        <button
          onClick={onClose}
          className="text-sm px-3 py-1 border rounded hover:bg-gray-50"
        >
          Cancel
        </button>

        <button
          onClick={onSend}
          className="text-sm px-3 py-1 bg-black text-[var(--color-wrcYellowUI)] rounded"
        >
          Copy + Open Draft
        </button>
      </div>
    </div>
  );
}