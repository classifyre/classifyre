"use client";

import { useEffect, useState } from "react";
import { ChevronsUpDown, User, Users } from "lucide-react";
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Spinner,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";
import {
  searchPrincipals,
  type GovernancePrincipalDto,
} from "@/lib/governance";

/**
 * A searchable list of the tenant's people and groups (GOV §5.2), for owners,
 * stewards and custodians. The server searches; people and groups show in
 * separate sections, and `kinds` narrows them (an owner is a person).
 */
export function PrincipalPicker({
  kinds,
  value,
  onChange,
  placeholder,
  disabled,
  id,
}: {
  kinds: readonly ("user" | "group")[];
  value: GovernancePrincipalDto | null;
  onChange: (principal: GovernancePrincipalDto | null) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GovernancePrincipalDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kindsKey = kinds.join(",");

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      searchPrincipals(
        query.trim(),
        kindsKey.split(",") as ("user" | "group")[],
      )
        .then((found) => {
          if (!active) return;
          setResults(found);
          setError(null);
        })
        .catch(async (caught: unknown) => {
          if (!active) return;
          setError(
            await extractApiErrorMessage(caught, t("governance.picker.failed")),
          );
        })
        .finally(() => active && setLoading(false));
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [open, query, kindsKey, t]);

  const people = results.filter((item) => item.kind === "user");
  const groups = results.filter((item) => item.kind === "group");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
          data-testid="principal-picker"
        >
          <span className="truncate">
            {value
              ? value.displayName
              : (placeholder ?? t("governance.picker.placeholder"))}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] min-w-72 p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={t("governance.picker.search")}
          />
          <CommandList>
            {loading && (
              <div className="flex justify-center py-4">
                <Spinner size="sm" />
              </div>
            )}
            {!loading && error && (
              <div className="px-3 py-4 text-sm text-destructive">{error}</div>
            )}
            {!loading && !error && (
              <CommandEmpty>{t("governance.picker.none")}</CommandEmpty>
            )}
            {!loading && !error && people.length > 0 && (
              <CommandGroup heading={t("governance.picker.people")}>
                {people.map((person) => (
                  <CommandItem
                    key={person.ref}
                    value={person.ref}
                    onSelect={() => {
                      onChange(person);
                      setOpen(false);
                    }}
                  >
                    <User
                      className="h-3.5 w-3.5 text-muted-foreground"
                      aria-hidden
                    />
                    <span className="truncate">{person.displayName}</span>
                    {person.email && (
                      <span className="ml-auto truncate text-xs text-muted-foreground">
                        {person.email}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {!loading && !error && groups.length > 0 && (
              <CommandGroup heading={t("governance.picker.groups")}>
                {groups.map((group) => (
                  <CommandItem
                    key={group.ref}
                    value={group.ref}
                    onSelect={() => {
                      onChange(group);
                      setOpen(false);
                    }}
                  >
                    <Users
                      className="h-3.5 w-3.5 text-muted-foreground"
                      aria-hidden
                    />
                    <span className="truncate">{group.displayName}</span>
                    {group.path && (
                      <span className="ml-auto truncate font-mono text-xs text-muted-foreground">
                        {group.path}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
