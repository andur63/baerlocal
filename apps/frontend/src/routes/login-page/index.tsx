import { type FormEvent, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { createClient } from "@supabase/supabase-js";
import { EmailInput } from "../../components/primitives/text-inputs/email-input.tsx";
import { ArrowWhiteRightIcon } from "../../components/primitives/icons/arrow-white-right-icon.tsx";
import { ChevronIcon } from "../../components/primitives/icons/chevron-icon.tsx";
import { AuthLayout } from "../../layouts/auth-layout.tsx";
import { useAuthStore } from "../../store/auth-store.ts";
import Content from "../../content.ts";
import { useAuthErrorStore } from "../../store/auth-error-store.ts";
import { supabase } from "../../../supabase-client.ts";
import * as Sentry from "@sentry/react";

const isLocalQuickLoginEnabled =
	import.meta.env.VITE_VERCEL_ENV === "development" ||
	import.meta.env.VITE_VERCEL_ENV === "local";

const LOCAL_DEFAULT_SERVICE_ROLE_KEY =
	"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

export function LoginPage() {
	const { error } = useAuthErrorStore();
	const { requestLoginOtp } = useAuthStore();
	const navigate = useNavigate();
	const formRef = useRef<HTMLFormElement | null>(null);
	const [isNoticeExpanded, setIsNoticeExpanded] = useState(false);
	const [isQuickLoggingIn, setIsQuickLoggingIn] = useState(false);

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();

		const email = event.currentTarget.email.value;

		await Sentry.startSpan(
			{ name: "User Login", op: "user.login.submit" },
			async (span) => {
				const { error: loginError } = await requestLoginOtp({ email, span });

				if (!loginError) {
					navigate(
						`/confirm-otp/?type=email&email=${encodeURIComponent(email)}&origin=login`,
					);
				}
			},
		);
	};

	const handleLocalQuickLogin = async () => {
		setIsQuickLoggingIn(true);
		const email = "local.admin@ts.berlin";
		const password = "LocalAdmin123!";
		try {
			let { error: signInError } = await supabase.auth.signInWithPassword({
				email,
				password,
			});

			if (signInError) {
				// Auto-provision the local admin user if not seeded yet
				const adminClient = createClient(
					import.meta.env.VITE_SUPABASE_URL,
					import.meta.env.VITE_TEST_SUPABASE_SERVICE_ROLE_KEY ||
						LOCAL_DEFAULT_SERVICE_ROLE_KEY,
					{
						auth: {
							autoRefreshToken: false,
							persistSession: false,
						},
					},
				);
				const { data: listData } = await adminClient.auth.admin.listUsers();
				const existing = listData?.users?.find((u) => u.email === email);
				let userId = existing?.id;
				if (existing) {
					await adminClient.auth.admin.updateUserById(existing.id, {
						password,
						email_confirm: true,
					});
				} else {
					const { data: created } = await adminClient.auth.admin.createUser({
						email,
						password,
						email_confirm: true,
						user_metadata: {
							first_name: "Local",
							last_name: "Admin",
						},
					});
					userId = created?.user?.id;
				}
				if (userId) {
					await adminClient
						.from("application_admins")
						.upsert([{ user_id: userId }]);
				}

				const retry = await supabase.auth.signInWithPassword({
					email,
					password,
				});
				signInError = retry.error;
			}

			if (signInError) {
				useAuthErrorStore.getState().handleError(signInError);
				return;
			}
			navigate("/");
		} finally {
			setIsQuickLoggingIn(false);
		}
	};

	return (
		<AuthLayout>
			<div className="flex flex-col min-h-[100svh] h-full w-full justify-center items-center bg-hellblau-30 px-5 py-12 md:py-[100px]">
				<div className="flex flex-col border max-w-[580px] w-full border-black py-8 px-5 md:p-10 rounded-3px bg-white">
					<h1 className="text-3xl leading-9 md:text-4xl md:leading-10 font-bold">
						{Content["loginPage.h1"]}
					</h1>
					<h2 className="text-xl">{Content["loginPage.h2"]}</h2>

					<div className="flex gap-3 bg-hellblau-55 p-3 rounded-3px mt-5 text-start break-words">
						<img
							className="self-start"
							src="/icons/info-dark-icon.svg"
							alt="info-icon"
						/>

						<div className="flex flex-col gap-3 min-w-0" id="login-notice">
							<p className="text-sm leading-5 md:text-base md:leading-6 font-semibold">
								{Content["loginPage.notice.heading"]}
							</p>
							{isNoticeExpanded && (
								<p className="text-sm leading-5 md:text-base md:leading-6 font-normal">
									{Content["loginPage.notice.body"]}
								</p>
							)}
							<button
								type="button"
								className="flex items-center text-sm leading-5 md:text-base md:leading-6 font-normal focus-visible:outline-default rounded-3px text-start w-fit"
								aria-label={
									isNoticeExpanded
										? Content["loginPage.notice.showLess.button.ariaLabel"]
										: Content["loginPage.notice.showMore.button.ariaLabel"]
								}
								aria-expanded={isNoticeExpanded}
								aria-controls="login-notice"
								onClick={() => setIsNoticeExpanded(!isNoticeExpanded)}
							>
								{isNoticeExpanded
									? Content["loginPage.notice.showLess.button.label"]
									: Content["loginPage.notice.showMore.button.label"]}
								{isNoticeExpanded ? (
									<ChevronIcon color="dunkelblau-200" direction="up" />
								) : (
									<ChevronIcon color="dunkelblau-200" direction="down" />
								)}
							</button>
						</div>
					</div>

					<form
						className="flex flex-col mt-9"
						ref={formRef}
						onSubmit={handleSubmit}
					>
						<label htmlFor="email" className="flex flex-col gap-y-1">
							{Content["loginPage.emailLabel"]}
							<EmailInput
								id="email"
								placeholder="vorname.name@subdomain.berlin.de"
								useEmailAllowedCheck={false}
							/>
						</label>

						<p className="mt-3 text-sm leading-5 text-schwarz-100">
							{Content["loginPage.otpHint"]}
						</p>

						{error && (
							<div
								className="text-berlin-rot mt-4 text-sm"
								dangerouslySetInnerHTML={{ __html: error }}
							/>
						)}

						<div className="flex flex-wrap gap-3 mt-12 justify-end items-center">
							{isLocalQuickLoginEnabled && (
								<button
									type="button"
									disabled={isQuickLoggingIn}
									onClick={handleLocalQuickLogin}
									className="flex gap-x-2 text-base items-center w-fit py-2 px-3 text-dunkelblau-100 border border-dunkelblau-100 rounded-3px bg-hellblau-30 hover:bg-hellblau-55 focus-visible:outline-default disabled:opacity-60"
								>
									{isQuickLoggingIn
										? "Anmeldung..."
										: "Lokaler Direkt-Login (Admin)"}
								</button>
							)}

							<button
								type="submit"
								className={`
									flex gap-x-2 text-lg items-center
									w-fit py-2 px-3 text-white rounded-3px 
									bg-dunkelblau-100 disabled:bg-schwarz-40
									hover:bg-dunkelblau-80 focus-visible:outline-default 
								`}
							>
								{Content["loginPage.submitButton"]}
								<ArrowWhiteRightIcon />
							</button>
						</div>
					</form>
				</div>
				<p className="mt-6 text-center md:text-left">
					{Content["loginPage.registerPrompt"]}{" "}
					<br className="block md:hidden" />
					<a
						href={"/register/"}
						className="font-bold underline hover:no-underline"
					>
						{Content["loginPage.registerLink"]}
					</a>
				</p>
			</div>
		</AuthLayout>
	);
}
