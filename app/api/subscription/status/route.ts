import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSubscriptionForUser } from "@/lib/subscription";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const info = await getSubscriptionForUser(supabase, user?.id ?? null);
    return NextResponse.json(info);
  } catch (error) {
    console.error("[subscription/status]", error);
    return NextResponse.json(
      {
        authenticated: false,
        hasAccess: false,
        status: "none",
        currentPeriodEnd: null,
        planId: null,
        message: "Erro ao consultar assinatura.",
      },
      { status: 500 }
    );
  }
}
