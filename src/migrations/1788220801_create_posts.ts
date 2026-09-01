// Örnek şema migration'ı: TS'te tipli field class'larıyla koleksiyon oluşturma.
// API kuralları bilinçli olarak null bırakıldı => yalnız superuser erişir.
migrate(
	(app) => {
		const collection = new Collection({
			type: "base",
			name: "posts",
		});

		collection.fields.add(
			new TextField({ name: "title", required: true, max: 200 }),
			new BoolField({ name: "published" }),
			new AutodateField({ name: "created", onCreate: true }),
			new AutodateField({ name: "updated", onCreate: true, onUpdate: true }),
		);

		app.save(collection);
	},
	(app) => {
		app.delete(app.findCollectionByNameOrId("posts"));
	},
);
