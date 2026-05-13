export function SignOutButton() {
  return (
    <form action="/auth/signout" method="post">
      <button type="submit" className="btn btn-ghost">
        Sign out
      </button>
    </form>
  );
}
