import { useEffect, useRef, useState } from "react";

export interface ShellTab {
  id: string;
  title: string;
}

interface TabBarProps {
  tabs: ShellTab[];
  activeId: string | null;
  onCreate: () => void;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onRename: (id: string, title: string) => void;
}

export function TabBar({
  tabs,
  activeId,
  onCreate,
  onSelect,
  onClose,
  onRename,
}: TabBarProps) {
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const cancelCommitRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editingTabId) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editingTabId]);

  const startEditing = (tab: ShellTab) => {
    cancelCommitRef.current = false;
    setEditingTabId(tab.id);
    setEditingTitle(tab.title);
    onSelect(tab.id);
  };

  const commitEditing = () => {
    if (cancelCommitRef.current) {
      cancelCommitRef.current = false;
      return;
    }

    if (!editingTabId) {
      return;
    }

    onRename(editingTabId, editingTitle);
    setEditingTabId(null);
    setEditingTitle("");
  };

  const cancelEditing = () => {
    cancelCommitRef.current = true;
    setEditingTabId(null);
    setEditingTitle("");
  };

  return (
    <div className="tab-bar">
      <div className="tab-list" role="tablist" aria-label="ShellForge tabs">
        {tabs.map((tab) => (
          <div className={tab.id === activeId ? "tab tab-active" : "tab"} key={tab.id}>
            {editingTabId === tab.id ? (
              <input
                aria-label="Workspace name"
                className="tab-rename-input"
                onBlur={commitEditing}
                onChange={(event) => setEditingTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitEditing();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    cancelEditing();
                  }
                }}
                ref={inputRef}
                value={editingTitle}
              />
            ) : (
              <button
                aria-selected={tab.id === activeId}
                className="tab-select"
                onClick={() => onSelect(tab.id)}
                onDoubleClick={() => startEditing(tab)}
                role="tab"
                title="Double click to rename"
                type="button"
              >
                {tab.title}
              </button>
            )}
            <button
              aria-label={`Close ${tab.title}`}
              className="tab-close"
              onClick={() => onClose(tab.id)}
              type="button"
            >
              x
            </button>
          </div>
        ))}
      </div>
      <button aria-label="New tab" className="tab-new" onClick={onCreate} type="button">
        +
      </button>
    </div>
  );
}
