// Example schema migration: creating a collection with typed field classes.
// API rules are intentionally left null => superuser-only access.
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
