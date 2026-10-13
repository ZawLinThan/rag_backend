import { supabase } from "../src/config/supabase.js";

const { data, error } = await supabase.auth.signInWithPassword({
  email: "test-user-1@example.com",
  password: "test-password",
});

if (error) {
  throw error;
}

console.log(data.session?.access_token);
