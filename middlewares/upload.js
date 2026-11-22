
import multer from "multer";

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024,
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
        ];

        if (!allowedTypes.includes(file.mimetype)) {
        return cb(
            new Error("Only JPEG, PNG, WEBP, and GIF images are allowed.")
        );
        }

        cb(null, true);
    },
});

export const handleImageUpload = (req, res, next) => {
    upload.single("image")(req, res, (error) => {
        if (error instanceof multer.MulterError) {
        if (error.code === "LIMIT_FILE_SIZE") {
            return res.status(413).send({
            message: "Image size must be 5MB or less.",
            });
        }

        return res.status(400).send({
            message: error.message,
        });
        }

        if (error) {
        return res.status(400).send({
            message: error.message,
        });
        }

    next();
    });
};
