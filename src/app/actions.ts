'use server';
import { expenseMessages } from '@/features/expenses/messages';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';
import { supabase } from '@/lib/supabase/server';
import { requireUser } from '@/lib/data';
import { i18n } from '@/lib/i18n/server';
import { safeNext, validImage, validName } from '@/lib/validation';
import { validCurrency } from '@/lib/currencies';
import { validTimezone } from '@/lib/timezones';
import { authErrorMessage } from '@/lib/auth-errors';
import { authReturnUrl, authFailurePath, siteOrigin as siteUrl } from '@/lib/auth-redirects';
export type ActionState = { error?: string; success?: string };
const field = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
export async function setPreferences(form: FormData) {
  const jar = await cookies();
  const locale = field(form, 'locale') === 'en' ? 'en' : 'es';
  const theme = field(form, 'theme') === 'dark' ? 'dark' : 'light';
  for (const [name, value] of Object.entries({ locale, theme }))
    jar.set(name, value, {
      path: '/',
      maxAge: 31536000,
      sameSite: 'lax',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
    });
  revalidatePath('/', 'layout');
}
export async function authAction(
  kind: 'login' | 'register' | 'recover' | 'reset',
  previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { t } = await i18n();
  try {
    const db = await supabase();
    const email = field(form, 'email');
    const password = String(form.get('password') ?? '');
    const next = safeNext(field(form, 'next'));
    if (kind === 'recover') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: t.invalid };
      const { error } = await db.auth.resetPasswordForEmail(email, {
        redirectTo: authReturnUrl(siteUrl(), '/auth/confirm', '/reset-password'),
      });
      if (error) return { error: authErrorMessage(error, t) };
      return { success: t.recoverySent };
    }
    if (kind === 'reset') {
      await requireUser();
      if (password.length < 4 || password.length > 128) return { error: t.invalid };
      const { error } = await db.auth.updateUser({ password });
      if (error) return { error: authErrorMessage(error, t) };
      redirect('/homes');
    }
    if (!email || password.length > 128 || password.length < (kind === 'register' ? 4 : 1))
      return { error: t.invalid };
    if (kind === 'register') {
      const name = field(form, 'name');
      if (!validName(name)) return { error: t.invalid };
      const { data, error } = await db.auth.signUp({
        email,
        password,
        options: {
          data: { name },
          emailRedirectTo: authReturnUrl(siteUrl(), '/auth/confirm', next),
        },
      });
      if (error) return { error: authErrorMessage(error, t) };
      if (!data.session) return { success: t.confirmEmail };
    } else {
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) return { error: authErrorMessage(error, t) };
    }
    const {
      data: { user },
    } = await db.auth.getUser();
    if (user) {
      const { data } = await db.from('profiles').select('locale,theme').eq('id', user.id).single();
      if (data) {
        const prefs = new FormData();
        prefs.set('locale', data.locale);
        prefs.set('theme', data.theme);
        await setPreferences(prefs);
      }
    }
    redirect(next);
  } catch (error) {
    unstable_rethrow(error);
    return { error: t.requestError };
  }
}
export async function googleAction(form: FormData) {
  const next = safeNext(field(form, 'next'));
  if (process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED !== 'true')
    redirect(authFailurePath(next, 'auth'));
  const db = await supabase();
  const { data, error } = await db.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: authReturnUrl(siteUrl(), '/auth/callback', next) },
  });
  if (error || !data.url) redirect(authFailurePath(next, 'auth'));
  redirect(data.url);
}
export async function logoutAction(previous: ActionState): Promise<ActionState> {
  void previous;
  const { t } = await i18n();
  try {
    const db = await supabase();
    const { error } = await db.auth.signOut();
    if (error) return { error: t.requestError };
  } catch {
    return { error: t.requestError };
  }
  revalidatePath('/', 'layout');
  redirect('/login');
}

async function upload(
  form: FormData,
  bucket: 'avatars' | 'home-images',
  owner: string,
): Promise<string | null> {
  const file = form.get('image');
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > 5242880) throw new Error('image');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!validImage(bytes, file.type)) throw new Error('image');
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/jpeg' ? 'jpg' : 'webp';
  const path = `${owner}/${crypto.randomUUID()}.${ext}`;
  const db = await supabase();
  const { error } = await db.storage
    .from(bucket)
    .upload(path, bytes, { contentType: file.type, upsert: false });
  if (error) throw new Error('upload');
  return path;
}
export async function homeAction(
  kind: 'create' | 'join' | 'update' | 'regenerate' | 'delete' | 'timezone',
  previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  void previous;
  const { t } = await i18n();
  try {
    const { db } = await requireUser();
    const id = field(form, 'home_id');
    if (kind === 'create') {
      const name = field(form, 'name');
      const currency = field(form, 'currency');
      if (!validName(name) || !validCurrency(currency)) return { error: t.invalid };
      const { data, error } = await db.rpc('create_home', {
        home_name: name,
        home_currency: currency,
      });
      if (error) return { error: t.requestError };
      revalidatePath('/homes');
      redirect(`/homes/${data}`);
    }
    if (kind === 'join') {
      const code = field(form, 'code').toLowerCase();
      if (!/^[a-f0-9]{32}$/.test(code)) return { error: t.invalidInvitation };
      const { data, error } = await db.rpc('join_home', { invite_code: code });
      if (error)
        return {
          error: error.message.includes('invalid_invitation')
            ? t.invalidInvitation
            : t.requestError,
        };
      revalidatePath('/homes');
      redirect(`/homes/${data}`);
    }
    if (!/^[a-f0-9-]{36}$/i.test(id)) return { error: t.invalid };
    if (kind === 'timezone') {
      const zone = field(form, 'timezone');
      if (!validTimezone(zone)) return { error: t.invalid };
      const { error } = await db.rpc('update_home_timezone', { target: id, zone });
      if (error)
        return { error: error.message === 'invalid_timezone' ? t.invalid : t.requestError };
      revalidatePath(`/homes/${id}`, 'layout');
      return { success: t.saved };
    }
    if (kind === 'update') {
      const name = field(form, 'name');
      const currency = field(form, 'currency');
      const week = Number(field(form, 'week_starts_on'));
      if (
        !validName(name) ||
        !validCurrency(currency) ||
        !Number.isInteger(week) ||
        week < 0 ||
        week > 6
      )
        return { error: t.invalid };
      const { data: home, error: readError } = await db
        .from('homes')
        .select('image_path')
        .eq('id', id)
        .single();
      if (readError) return { error: t.requestError };
      const path = await upload(form, 'home-images', id);
      const image = path ?? (form.get('remove_image') ? null : home.image_path);
      const { error } = await db.rpc('update_home', {
        target: id,
        home_name: name,
        home_currency: currency,
        home_image: image,
        week_start: week,
      });
      if (error) {
        if (path) await db.storage.from('home-images').remove([path]);
        return {
          error: error.message.includes('currency_has_history')
            ? expenseMessages((await i18n()).locale).currencyLocked
            : t.requestError,
        };
      }
      // Superseded files are retained for now; concurrent editors may still reference them.
    }
    if (kind === 'regenerate') {
      if (form.get('confirm') !== 'on') return { error: t.confirmRequired };
      const { error } = await db.rpc('regenerate_invitation', { target: id });
      if (error) return { error: t.requestError };
    }
    if (kind === 'delete') {
      if (form.get('confirm') !== 'on') return { error: t.confirmRequired };
      const { error } = await db.rpc('delete_home', { target: id });
      if (error)
        return {
          error: error.message.includes('home_has_members')
            ? t.deleteError
            : error.message.includes('home_has_balances')
              ? expenseMessages((await i18n()).locale).homeDebt
              : t.requestError,
        };
      revalidatePath('/homes');
      redirect('/homes');
    }
    revalidatePath('/homes', 'layout');
    return { success: kind === 'regenerate' ? t.invitationReady : t.saved };
  } catch (error) {
    unstable_rethrow(error);
    return {
      error: error instanceof Error && error.message === 'image' ? t.imageError : t.requestError,
    };
  }
}
export async function profileAction(previous: ActionState, form: FormData): Promise<ActionState> {
  void previous;
  const { t } = await i18n();
  try {
    const { db, user } = await requireUser();
    const name = field(form, 'name');
    if (!validName(name)) return { error: t.invalid };
    const { data: profile, error: readError } = await db
      .from('profiles')
      .select('avatar_path')
      .eq('id', user.id)
      .single();
    if (readError) return { error: t.requestError };
    const path = await upload(form, 'avatars', user.id);
    const avatar = path ?? (form.get('remove_image') ? null : profile.avatar_path);
    const locale = field(form, 'locale') === 'en' ? 'en' : 'es';
    const theme = field(form, 'theme') === 'dark' ? 'dark' : 'light';
    const { error } = await db
      .from('profiles')
      .update({ name, avatar_path: avatar, locale, theme })
      .eq('id', user.id);
    if (error) {
      if (path) await db.storage.from('avatars').remove([path]);
      return { error: t.requestError };
    }
    await setPreferences(form);
    revalidatePath('/', 'layout');
    return { success: t.saved };
  } catch (error) {
    unstable_rethrow(error);
    return {
      error: error instanceof Error && error.message === 'image' ? t.imageError : t.requestError,
    };
  }
}
