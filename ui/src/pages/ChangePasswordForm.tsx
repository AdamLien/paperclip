import { useId, useRef, useState, type FormEvent } from "react";
import { KeyRound, LoaderCircle } from "lucide-react";
import { AuthApiError, authApi } from "@/api/auth";
import { useTranslation } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ChangePasswordForm() {
  const { t } = useTranslation("profilePassword");
  const id = useId();
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const currentPassword = String(data.get("currentPassword") ?? "");
    const newPassword = String(data.get("newPassword") ?? "");
    const confirmation = String(data.get("confirmPassword") ?? "");
    setChanged(false);
    if (!currentPassword || !newPassword || !confirmation) {
      setErrorKey("required");
      return;
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      setErrorKey("length");
      return;
    }
    if (newPassword !== confirmation) {
      setErrorKey("mismatch");
      return;
    }
    if (currentPassword === newPassword) {
      setErrorKey("different");
      return;
    }
    submitting.current = true;
    setPending(true);
    setErrorKey(null);
    try {
      // Passwords must not enter React Query's mutation cache or persistent state.
      await authApi.changePassword({ currentPassword, newPassword });
      setChanged(true);
    } catch (error) {
      let key = "failed";
      if (error instanceof AuthApiError) {
        if (error.code === "INVALID_PASSWORD") key = "incorrect";
        else if (error.status === 401) key = "expired";
        else if (error.status === 429) key = "rateLimited";
        else if (error.code === "PASSWORD_TOO_SHORT" || error.code === "PASSWORD_TOO_LONG") key = "length";
      }
      setErrorKey(key);
    } finally {
      form.reset();
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="space-y-4">
      <div className="space-y-2">
        <h2 id={`${id}-heading`} className="flex items-center gap-2 text-lg font-semibold">
          <KeyRound className="h-5 w-5" aria-hidden="true" />
          {t("title")}
        </h2>
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">{t("hint")}</p>
      </div>
      <form onSubmit={submit} aria-describedby={`${id}-hint`}>
        <fieldset disabled={pending} className="space-y-4">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor={`${id}-current`}>{t("current")}</Label>
              <Input id={`${id}-current`} name="currentPassword" type="password" autoComplete="current-password" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${id}-new`}>{t("new")}</Label>
              <Input id={`${id}-new`} name="newPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${id}-confirm`}>{t("confirm")}</Label>
              <Input id={`${id}-confirm`} name="confirmPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required />
            </div>
          </div>
          {errorKey ? <p role="alert" className="text-sm text-destructive">{t(errorKey)}</p> : null}
          {changed ? <p role="status" className="text-sm text-muted-foreground">{t("success")}</p> : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {t(pending ? "changing" : "title")}
            </Button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
