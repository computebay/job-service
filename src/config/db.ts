import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";

const prisma = new PrismaClient();

// const addUser = async () => {
//   await prisma.user.create({
//     data: {
//       name: "Test2",
//       email: "1233@gmail.com",
//       provider: "oauth",
//     },
//   });
// };

// await addUser();

export default prisma;
