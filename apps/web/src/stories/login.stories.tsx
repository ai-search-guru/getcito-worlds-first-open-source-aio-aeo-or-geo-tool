/**
 * Stories for the email/password login form.
 *
 * Renders <EmailPasswordLogin /> directly to bypass the file-route wrapper,
 * since Route.useSearch() isn't modeled by the router mock.
 */
import type { Meta } from "@storybook/react";
import { EmailPasswordLogin } from "@/routes/auth/login";

export default {
	title: "Auth / Login",
} satisfies Meta;

/** Demo mode — shows the pre-filled credentials callout. */
export const Demo = () => <EmailPasswordLogin isDemo />;

/** Local — empty fields, "Create one" register link visible (instance unbootstrapped). */
export const StandardUnbootstrapped = () => <EmailPasswordLogin canRegister />;

/** Local — after the single user has signed up; register link hidden. */
export const StandardBootstrapped = () => <EmailPasswordLogin />;
