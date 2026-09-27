export default defineApi((event, body) => auth.registerVerify(reqOf(event), body))
