export default defineApi((event, body) => auth.loginVerify(reqOf(event), body))
