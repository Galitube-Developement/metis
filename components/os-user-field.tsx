"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";

export type OsUserOption = {
  username: string;
  uid?: number;
  gid?: number;
  home?: string;
};

export function OsUserField({
  value,
  onChange,
  osUsers,
  ariaLabel,
  className = "h-8 font-normal",
}: {
  value: string;
  onChange: (value: string) => void;
  osUsers: OsUserOption[];
  ariaLabel: string;
  className?: string;
}) {
  const listId = useId();
  return (
    <>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        list={listId}
        placeholder="Select or type an OS user"
        aria-label={ariaLabel}
        className={className}
        autoComplete="off"
        spellCheck={false}
      />
      <datalist id={listId}>
        {osUsers.map((user) => (
          <option key={user.username} value={user.username}>
            {user.uid !== undefined
              ? `${user.username} · uid ${user.uid}`
              : user.home
                ? `${user.username} · ${user.home}`
                : user.username}
          </option>
        ))}
      </datalist>
    </>
  );
}
