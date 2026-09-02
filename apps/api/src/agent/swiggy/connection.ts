import { User } from "db";

export async function checkSwiggyConnection(
  userId: string,
): Promise<{ isSwiggyConnected: boolean; swiggyAccessToken: string }> {
  const user = await User.findById(userId).select(
    "+swiggyAccessToken +swiggyTokenExpiresAt",
  );

  const isSwiggyConnected =
    !!user?.swiggyAccessToken &&
    !!user?.swiggyTokenExpiresAt &&
    user.swiggyTokenExpiresAt > new Date();

  return {
    isSwiggyConnected,
    swiggyAccessToken: user?.swiggyAccessToken || "",
  };
}
