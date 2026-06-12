import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "@/lib/queryClient";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface CompanyOption {
  id: number;
  name: string;
  logo_url: string | null;
  gst: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
}

const LAST_COMPANY_KEY = "narmada:last_company_id";

interface CompanyPickerProps {
  value: number | null;
  onChange: (id: number) => void;
  disabled?: boolean;
  required?: boolean;
}

// R13: unified ordered-company picker used on PO upload + quotation forms and the PO /
// quotation headers. Lists active companies from GET /api/companies, remembers the
// last-used company in localStorage, and pre-selects it when no value is set.
export function CompanyPicker({ value, onChange, disabled, required }: CompanyPickerProps) {
  const { data: companies = [], isLoading } = useQuery<CompanyOption[]>({
    queryKey: ["/api/companies"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/companies"));
      if (!res.ok) throw new Error("Failed to load companies");
      return res.json();
    },
  });

  // Pre-select last-used (or the only) company when nothing is chosen yet.
  useEffect(() => {
    if (value != null || companies.length === 0) return;
    const stored = Number(localStorage.getItem(LAST_COMPANY_KEY));
    const match = companies.find((c) => c.id === stored);
    const pick = match ?? (companies.length === 1 ? companies[0] : undefined);
    if (pick) onChange(pick.id);
  }, [value, companies, onChange]);

  const handleChange = (raw: string) => {
    const id = Number(raw);
    if (!Number.isNaN(id)) {
      localStorage.setItem(LAST_COMPANY_KEY, String(id));
      onChange(id);
    }
  };

  return (
    <Select
      value={value != null ? String(value) : undefined}
      onValueChange={handleChange}
      disabled={disabled || isLoading}
      required={required}
    >
      <SelectTrigger data-testid="company-picker">
        <SelectValue placeholder={isLoading ? "Loading companies…" : "Select company"} />
      </SelectTrigger>
      <SelectContent>
        {companies.map((c) => (
          <SelectItem key={c.id} value={String(c.id)}>
            <span className="flex items-center gap-2">
              {c.logo_url ? (
                <img src={c.logo_url} alt="" className="h-4 w-4 rounded object-contain" />
              ) : null}
              <span>{c.name}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default CompanyPicker;
