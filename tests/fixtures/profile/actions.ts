export type ActionState = { error?: string; success?: string };
export async function profileAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  document.documentElement.dataset.submissions = String(
    Number(document.documentElement.dataset.submissions ?? 0) + 1,
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  return form.get('name') === 'Fail save' ? { error: 'Save failed' } : { success: 'Saved' };
}
