import { z } from 'zod'

export const JobRegisterSchema = z.object({
    ownerUserId: z.string(),
    status: z.enum(["QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"]),
    priority: z.number().optional(),

    jobType: z.string(),
    runtime: z.string(),

    entrypoint: z.string().array(),

    resources: z.json(),
    retryPolicy: z.json().optional(),

    inputArtifcats: z.json(),
    outputArtificats: z.json().optional(),

    costEstimate: z.number().optional(),
    costActual: z.number().optional(),

    scheduledAt: z.date().optional(),
    startedAt: z.date().optional(),
    completedAt: z.date().optional(),

})

export type JobRegisterInput = z.infer<typeof JobRegisterSchema>