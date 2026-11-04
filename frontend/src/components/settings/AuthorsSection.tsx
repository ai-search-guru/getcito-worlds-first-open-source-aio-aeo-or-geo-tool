'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ImageUploadButton } from '@/components/content/ImageUploadButton';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingDots } from '@/components/ui/loading-dots';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  deleteContentAuthor,
  getContentAuthors,
  saveContentAuthor,
  setBrandByline,
  setDefaultAuthor,
} from '@/lib/actions/contentAuthors';
import {
  authorInitials,
  canEditAuthor,
  MAX_LINK_LENGTH,
  MAX_PROFILES,
  type AuthorInput,
  type AuthorsRead,
  type ContentAuthor,
} from '@/lib/content/authors';
import { cn } from '@/lib/utils';
import { useUpgradeGate } from '@/components/context/upgradeGate';

/** The organization byline in a brand's default select: no author. */
const ORGANIZATION = 'organization';

const isHttps = (value: string) => /^https:\/\/\S+$/.test(value);

/**
 * Settings › Authors (Content Editor Quality spec §9, CE-037): the real
 * people the workspace's pages are by. Anyone adds one; whoever added it,
 * the author themself or an admin edits or deletes it; admins and managers
 * pick each brand's default. "Real people only. Content Agent can't add,
 * edit or invent authors."
 */
export function AuthorsSection() {
  const t = useTranslations('settings.authors');
  const tCommon = useTranslations('common');
  const [read, setRead] = useState<AuthorsRead | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<ContentAuthor | 'new' | null>(null);
  const [removing, setRemoving] = useState<ContentAuthor | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /** A brand's default being saved: shown at once, the select held until it lands. */
  const [picking, setPicking] = useState<Record<string, string>>({});
  /** A brand's Add byline to content being saved, likewise. */
  const [bylining, setBylining] = useState<Record<string, boolean>>({});
  // A read-only workspace (plan not active): Add, Edit, Remove, a default
  // and the byline box open the upgrade dialog instead.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');

  const load = useCallback(async () => {
    try {
      const next = await getContentAuthors({ pages: true });
      setRead(next);
      setFailed(!next);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const me = read?.me.id;
  const canEdit = (author: ContentAuthor) => !!read && canEditAuthor(author, read.me);
  const canSetDefaults = read?.me.role === 'admin' || read?.me.role === 'manager';
  const defaultOf = (brandId: string) =>
    picking[brandId] ??
    read?.authors.find((a) => a.defaultFor.includes(brandId))?.id ??
    ORGANIZATION;

  const remove = async (author: ContentAuthor) => {
    setBusy(true);
    try {
      await deleteContentAuthor(author.id);
      toast.success(t('removed', { name: author.name }));
      setRemoveOpen(false);
      await load();
    } catch {
      toast.error(t('removeFailed'));
    } finally {
      setBusy(false);
    }
  };
  const pickDefault = async (brandId: string, value: string) => {
    setPicking((prev) => ({ ...prev, [brandId]: value }));
    try {
      await setDefaultAuthor(brandId, value === ORGANIZATION ? null : value);
      await load();
    } catch {
      toast.error(t('defaultFailed'));
    } finally {
      setPicking((prev) => {
        const next = { ...prev };
        delete next[brandId];
        return next;
      });
    }
  };

  const toggleByline = async (brandId: string, on: boolean) => {
    setBylining((prev) => ({ ...prev, [brandId]: on }));
    try {
      await setBrandByline(brandId, on);
      await load();
    } catch {
      toast.error(t('bylineFailed'));
    } finally {
      setBylining((prev) => {
        const next = { ...prev };
        delete next[brandId];
        return next;
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
          {t('realPeople')}
        </p>

        {!read && !failed && (
          <p className="text-sm text-muted-foreground" aria-busy="true">
            <LoadingDots />
            <span className="sr-only">{t('loading')}</span>
          </p>
        )}
        {failed && (
          <p className="text-sm text-destructive">
            {t('loadFailed')}{' '}
            <button type="button" className="underline" onClick={() => void load()}>
              {tCommon('retry')}
            </button>
          </p>
        )}

        {read && (
          <>
            {read.authors.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('empty')}</p>
            ) : (
              <ul className="divide-y rounded-xl border">
                {read.authors.map((author) => (
                  <li key={author.id} className="flex items-start gap-3 px-3 py-2.5">
                    <AuthorPhoto author={author} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium [overflow-wrap:anywhere]">
                        {author.name}
                        {author.userId === me && (
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                            {t('you')}
                          </span>
                        )}
                      </p>
                      {author.title && (
                        <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                          {author.title}
                        </p>
                      )}
                      <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                        {t('profiles', { count: author.sameAs.length })}
                        {author.pages !== null && (
                          <>
                            {' · '}
                            {t('pages', { count: author.pages })}
                          </>
                        )}
                        {author.defaultFor.length > 0 && (
                          <>
                            {' · '}
                            {t('defaultFor', {
                              brands: read.brands
                                .filter((b) => author.defaultFor.includes(b.id))
                                .map((b) => b.name)
                                .join(', '),
                            })}
                          </>
                        )}
                      </p>
                    </div>
                    {canEdit(author) && (
                      <span className="flex shrink-0 gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={guard(() => setEditing(author), {
                            action: tActions('editAuthors'),
                          })}
                        >
                          {t('edit')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={guard(
                            () => {
                              setRemoving(author);
                              setRemoveOpen(true);
                            },
                            { action: tActions('removeAuthors') },
                          )}
                        >
                          {t('remove')}
                        </Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <Button
              size="sm"
              onClick={guard(() => setEditing('new'), { action: tActions('addAuthors') })}
            >
              {t('add')}
            </Button>

            {read.brands.length > 0 && (
              <section className="space-y-2" aria-label={t('defaultsTitle')}>
                <h3 className="text-sm font-medium">{t('defaultsTitle')}</h3>
                <p className="text-xs text-muted-foreground">{t('defaultsHint')}</p>
                <ul className="space-y-2">
                  {read.brands.map((brand) => {
                    const items = [
                      {
                        value: ORGANIZATION,
                        label: t('organizationByline', { brand: brand.name }),
                      },
                      ...read.authors.map((a) => ({ value: a.id, label: a.name })),
                    ];
                    return (
                      <li key={brand.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span
                          id={`default-${brand.id}`}
                          className="min-w-32 text-sm [overflow-wrap:anywhere]"
                        >
                          {brand.name}
                        </span>
                        <Select
                          items={items}
                          value={defaultOf(brand.id)}
                          disabled={!canSetDefaults || brand.id in picking}
                          onValueChange={guard(
                            (value: string | null) => {
                              if (value && value !== defaultOf(brand.id)) {
                                void pickDefault(brand.id, value);
                              }
                            },
                            { action: tActions('setDefaultAuthor') },
                          )}
                        >
                          <SelectTrigger
                            size="sm"
                            className="w-60 max-w-full"
                            aria-labelledby={`default-${brand.id}`}
                          >
                            <SelectValue className="truncate" />
                          </SelectTrigger>
                          <SelectContent>
                            {items.map((item) => (
                              <SelectItem key={item.value} value={item.value}>
                                {item.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {brand.id in picking && <LoadingDots className="text-muted-foreground" />}
                        <label className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={bylining[brand.id] ?? !!brand.bylineInContent}
                            aria-describedby={`default-${brand.id}`}
                            disabled={!canSetDefaults || brand.id in bylining}
                            onCheckedChange={guard(
                              (checked: boolean) => void toggleByline(brand.id, checked === true),
                              { action: tActions('setByline') },
                            )}
                          />
                          {t('bylineInContent')}
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <p className="text-xs text-muted-foreground">{t('bylineInContentHint')}</p>
                {!canSetDefaults && (
                  <p className="text-xs text-muted-foreground">{t('defaultsManagers')}</p>
                )}
              </section>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={removeOpen} onOpenChange={(next) => !next && !busy && setRemoveOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('removeTitle', { name: removing?.name ?? '' })}</DialogTitle>
            <DialogDescription>
              {removing?.pages == null
                ? t('removeDescriptionUncounted')
                : t('removeDescription', { count: removing.pages })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={busy} />}>
              {tCommon('cancel')}
            </DialogClose>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => removing && void remove(removing)}
            >
              {busy && <LoadingDots className="mr-1.5" />}
              {t('remove')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AuthorDialog
        author={editing === 'new' ? null : editing}
        open={editing !== null}
        me={me ?? null}
        meTaken={
          !!read?.authors.some(
            (a) => a.userId === me && (editing === 'new' || a.id !== editing?.id),
          )
        }
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await load();
        }}
      />
    </Card>
  );
}

/** The author's photo, or their initials. */
function AuthorPhoto({ author }: { author: ContentAuthor }) {
  const initials = authorInitials(author.name);
  return author.photoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- any https host the person names
    <img
      src={author.photoUrl}
      alt=""
      className="h-8 w-8 shrink-0 rounded-full object-cover"
      referrerPolicy="no-referrer"
    />
  ) : (
    <span
      aria-hidden
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
    >
      {initials}
    </span>
  );
}

/** Add or edit an author: name, title, a short bio, profile links, a photo. */
function AuthorDialog({
  author,
  open,
  me,
  meTaken,
  onClose,
  onSaved,
}: {
  author: ContentAuthor | null;
  open: boolean;
  me: string | null;
  /** The member is another author already: they can't be this one too. */
  meTaken: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations('settings.authors');
  const tUpload = useTranslations('content.imageUpload');
  const tCommon = useTranslations('common');
  const [form, setForm] = useState<{
    name: string;
    title: string;
    bio: string;
    photoUrl: string;
    links: string;
    isMe: boolean;
  }>({ name: '', title: '', bio: '', photoUrl: '', links: '', isMe: false });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setForm({
      name: author?.name ?? '',
      title: author?.title ?? '',
      bio: author?.bio ?? '',
      photoUrl: author?.photoUrl ?? '',
      links: author?.sameAs.join('\n') ?? '',
      isMe: !!author && author.userId === me,
    });
  }, [open, author, me]);

  // Another member's author stays theirs; only they unlink it.
  const someoneElse = !!author?.userId && author.userId !== me;
  const links = form.links
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const badLink = links.find((l) => !isHttps(l) || l.length > MAX_LINK_LENGTH);
  const linksInvalid = !!badLink || links.length > MAX_PROFILES;
  const photo = form.photoUrl.trim();
  const badPhoto = photo !== '' && !isHttps(photo);
  const invalid = !form.name.trim() || linksInvalid || badPhoto || saving;

  const save = async () => {
    setSaving(true);
    try {
      const input: AuthorInput = {
        ...(author ? { id: author.id } : {}),
        name: form.name,
        title: form.title,
        bio: form.bio,
        photoUrl: form.photoUrl,
        sameAs: links,
        isMe: form.isMe,
      };
      const saved = await saveContentAuthor(input);
      if ('error' in saved) {
        toast.error(t('alreadyAuthor'));
        return;
      }
      toast.success(t('saved', { name: form.name.trim() }));
      await onSaved();
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !saving && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{author ? t('editTitle') : t('addTitle')}</DialogTitle>
          <DialogDescription>{t('realPeople')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="author-name">{t('fields.name')}</Label>
            <Input
              id="author-name"
              value={form.name}
              maxLength={120}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="author-title">{t('fields.title')}</Label>
            <Input
              id="author-title"
              value={form.title}
              maxLength={120}
              placeholder={t('fields.titleHint')}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="author-bio">{t('fields.bio')}</Label>
            <Textarea
              id="author-bio"
              value={form.bio}
              maxLength={400}
              rows={3}
              placeholder={t('fields.bioHint')}
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="author-links">{t('fields.links')}</Label>
            <Textarea
              id="author-links"
              value={form.links}
              rows={3}
              placeholder="https://www.linkedin.com/in/…"
              aria-invalid={linksInvalid}
              aria-describedby="author-links-hint"
              onChange={(e) => setForm({ ...form, links: e.target.value })}
            />
            <p
              id="author-links-hint"
              className={cn(
                'text-xs [overflow-wrap:anywhere]',
                linksInvalid ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {badLink
                ? t('fields.linkInvalid', { link: badLink, max: MAX_LINK_LENGTH })
                : t('fields.linksHint', { max: MAX_PROFILES })}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="author-photo">{t('fields.photo')}</Label>
            <Input
              id="author-photo"
              value={form.photoUrl}
              placeholder="https://"
              aria-invalid={badPhoto}
              onChange={(e) => setForm({ ...form, photoUrl: e.target.value })}
            />
            {/* Or the photo from their computer (00272): its address fills the field. */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <ImageUploadButton
                className="h-7"
                onUploaded={(url) => setForm((prev) => ({ ...prev, photoUrl: url }))}
              />
              <span className="text-xs text-muted-foreground">{tUpload('hint')}</span>
            </div>
          </div>
          <div className="space-y-1">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.isMe}
                disabled={someoneElse || (meTaken && !form.isMe)}
                onCheckedChange={(checked) => setForm({ ...form, isMe: checked === true })}
              />
              {t('fields.isMe')}
            </label>
            {(someoneElse || meTaken) && (
              <p className="pl-6 text-xs text-muted-foreground">
                {someoneElse ? t('fields.isSomeoneElse') : t('fields.isMeTaken')}
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={saving} />}>
            {tCommon('cancel')}
          </DialogClose>
          <Button onClick={() => void save()} disabled={invalid}>
            {saving && <LoadingDots className="mr-1.5" />}
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
