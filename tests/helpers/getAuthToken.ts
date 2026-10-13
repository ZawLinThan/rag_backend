import { supabase } from "../../src/config/supabase.js";

const { data, error } = await supabase.auth.signInWithPassword({
  email: "test-user-1@example.com",
  password: "test-password",
});

if (error) {
  throw error;
}

console.log(data.session?.access_token, "\n\n");


const { data: data2, error: error2 } = await supabase.auth.signInWithPassword({
  email: "test-user-2@example.com",
  password: "test-password",
});

if (error2) {
  throw error2;
}

console.log(data2.session?.access_token, "\n\n");

